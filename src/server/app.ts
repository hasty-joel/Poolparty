import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { SupabaseServerService } from './supabaseServer';
import { RelworxService } from './relworxService';

dotenv.config();

export const app = express();

app.use(express.json({ limit: '1mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

import crypto from 'crypto';

// ============================================================
// PERSISTENT PRODUCTION-COMPATIBLE RATE LIMITER
// ============================================================
function rateLimit(options: { windowMs: number; max: number; keyGenerator?: (req: Request) => string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = options.keyGenerator
        ? options.keyGenerator(req)
        : (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown-ip';

      const check = await SupabaseServerService.checkRateLimitPersistent(`ip:${key}`, options.max, options.windowMs);
      if (!check.allowed) {
        res.setHeader('Retry-After', check.retryAfterSeconds);
        return res.status(429).json({
          success: false,
          message: 'Too many requests. Please slow down and try again shortly.',
          retryAfterSeconds: check.retryAfterSeconds,
        });
      }
      next();
    } catch {
      next();
    }
  };
}

// ============================================================
// ADMIN SECURITY & BRUTE-FORCE PROTECTION (Fail-Secure)
// ============================================================
interface AdminAttemptRecord {
  failedAttempts: number;
  lockedUntil: number;
}
const adminAttemptsMap = new Map<string, AdminAttemptRecord>();
const MAX_ADMIN_FAILED_ATTEMPTS = 5;
const ADMIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.socket.remoteAddress || 'unknown-ip';
}

export function isIpLockedOut(ip: string): { locked: boolean; remainingSeconds: number } {
  const record = adminAttemptsMap.get(ip);
  if (!record || record.lockedUntil <= Date.now()) {
    return { locked: false, remainingSeconds: 0 };
  }
  return {
    locked: true,
    remainingSeconds: Math.ceil((record.lockedUntil - Date.now()) / 1000),
  };
}

export function recordFailedAdminAttempt(ip: string): { locked: boolean; remainingAttempts: number; remainingSeconds: number } {
  const now = Date.now();
  let record = adminAttemptsMap.get(ip);
  if (!record || record.lockedUntil <= now) {
    record = { failedAttempts: 1, lockedUntil: 0 };
  } else {
    record.failedAttempts++;
  }

  if (record.failedAttempts >= MAX_ADMIN_FAILED_ATTEMPTS) {
    record.lockedUntil = now + ADMIN_LOCKOUT_MS;
    adminAttemptsMap.set(ip, record);
    return { locked: true, remainingAttempts: 0, remainingSeconds: Math.ceil(ADMIN_LOCKOUT_MS / 1000) };
  }

  adminAttemptsMap.set(ip, record);
  return {
    locked: false,
    remainingAttempts: MAX_ADMIN_FAILED_ATTEMPTS - record.failedAttempts,
    remainingSeconds: 0,
  };
}

export function resetAdminAttempts(ip: string) {
  adminAttemptsMap.delete(ip);
}

export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Admin Passcode Authorization Middleware
 * Rules:
 * 1. Strictly fail-secure if ADMIN_PASSCODE is not set in environment (HTTP 503)
 * 2. Zero fallback to hardcoded default values
 * 3. Constant-time timing-safe string comparison
 * 4. IP-based brute force protection (locks out after 5 consecutive failures for 15 minutes)
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const masterPasscode = process.env.ADMIN_PASSCODE ? process.env.ADMIN_PASSCODE.trim() : '';

  // 1. Fail securely if ADMIN_PASSCODE is missing in environment
  if (!masterPasscode) {
    console.error('[SECURITY ALERT] Admin access attempted but ADMIN_PASSCODE is missing in environment variables.');
    return res.status(503).json({
      success: false,
      error: 'Admin access is disabled. ADMIN_PASSCODE environment variable is not configured.',
    });
  }

  const clientIp = getClientIp(req);

  // 2. Check brute-force lockout
  const lockout = isIpLockedOut(clientIp);
  if (lockout.locked) {
    res.setHeader('Retry-After', lockout.remainingSeconds);
    return res.status(429).json({
      success: false,
      error: `Admin access temporarily locked due to repeated invalid passcode attempts. Please try again in ${Math.ceil(lockout.remainingSeconds / 60)} minutes.`,
      retryAfterSeconds: lockout.remainingSeconds,
    });
  }

  // 3. Extract provided passcode
  const provided = (req.headers['x-admin-passcode'] || req.query.passcode || req.body?.passcode) as string | undefined;

  if (!provided || typeof provided !== 'string' || !timingSafeCompare(provided.trim(), masterPasscode)) {
    const penalty = recordFailedAdminAttempt(clientIp);
    if (penalty.locked) {
      res.setHeader('Retry-After', penalty.remainingSeconds);
      return res.status(429).json({
        success: false,
        error: `Admin access temporarily locked due to ${MAX_ADMIN_FAILED_ATTEMPTS} failed attempts. Please try again in 15 minutes.`,
        retryAfterSeconds: penalty.remainingSeconds,
      });
    }

    return res.status(401).json({
      success: false,
      error: `Unauthorized: Invalid Admin passcode. ${penalty.remainingAttempts} attempt(s) remaining before temporary lockout.`,
    });
  }

  // Passcode is valid! Reset failure counter
  resetAdminAttempts(clientIp);
  next();
}

// ============================================================
// PUBLIC API ENDPOINTS
// ============================================================

/**
 * Public available ticket counts:
 * Returns ONLY available numbers without exposing buyer names, emails, phones, or QR tokens
 */
app.get(
  '/api/inventory/counts',
  rateLimit({ windowMs: 60 * 1000, max: 120 }),
  async (req: Request, res: Response) => {
    try {
      const counts = await SupabaseServerService.getPublicCounts();
      res.json({ success: true, counts });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Server error retrieving inventory' });
    }
  }
);

/**
 * Relworx Uganda Mobile Money Payment Initiation (MTN & Airtel)
 * Official Relworx API: https://payments.relworx.com/docs
 *
 * Strict Validations:
 * 1. Category must be 'VIP' (50,000 UGX) or 'ORDINARY' (20,000 UGX)
 * 2. Quantity must be 1 to 10
 * 3. Mobile money phone number validated for Uganda
 * 4. Rate-limited to max 5 requests per 10 minutes per phone number
 */
app.post(
  '/api/payments/relworx-initiate',
  rateLimit({ windowMs: 60 * 1000, max: 20 }),
  async (req: Request, res: Response) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone, network } = req.body || {};

      // Input presence checks
      if (!category || !quantity || !buyerName || !buyerEmail || !buyerPhone || !network) {
        return res.status(400).json({
          success: false,
          message: 'All fields are required: Full Name, Email, Phone Number, Ticket Tier, and Network (MTN or Airtel).',
        });
      }

      // Tier check
      if (category !== 'VIP' && category !== 'ORDINARY') {
        return res.status(400).json({
          success: false,
          message: 'Invalid ticket category. Must be VIP (UGX 50,000) or ORDINARY (UGX 20,000).',
        });
      }

      // Quantity check
      const qty = parseInt(String(quantity), 10);
      if (isNaN(qty) || qty < 1 || qty > 10) {
        return res.status(400).json({
          success: false,
          message: 'Quantity must be an integer between 1 and 10.',
        });
      }

      // Network check
      if (network !== 'MTN' && network !== 'AIRTEL') {
        return res.status(400).json({
          success: false,
          message: 'Network must be MTN or AIRTEL.',
        });
      }

      // Name & Email validation
      const cleanName = String(buyerName).trim();
      if (cleanName.length < 2 || cleanName.length > 80) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid attendee full name (2-80 characters).',
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const cleanEmail = String(buyerEmail).trim();
      if (!emailRegex.test(cleanEmail) || cleanEmail.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address for your ticket confirmation.',
        });
      }

      // Phone formatting & validation
      const { msisdn, valid } = RelworxService.formatUgandaMsisdn(String(buyerPhone));
      if (!valid) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Uganda phone number (e.g. 0775 123 456 or +256701234567).',
        });
      }

      // Phone number persistent rate limit (Relworx allows max 5 requests per 10 minutes per phone)
      const phoneRateLimit = await SupabaseServerService.checkRateLimitPersistent(`phone:${msisdn}`, 5, 10 * 60 * 1000);
      if (!phoneRateLimit.allowed) {
        res.setHeader('Retry-After', phoneRateLimit.retryAfterSeconds);
        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded: A maximum of 5 payment attempts per 10 minutes is allowed for this phone number.',
          retryAfterSeconds: phoneRateLimit.retryAfterSeconds,
        });
      }

      // Initiate payment via atomic service
      const result = await SupabaseServerService.initiateRelworxPayment({
        category,
        quantity: qty,
        buyerName: cleanName,
        buyerEmail: cleanEmail,
        buyerPhone: msisdn,
        network,
      });

      if (!result.success) {
        return res.status(409).json(result);
      }

      res.json(result);
    } catch (err: any) {
      console.error('[Relworx Initiate Route Exception]', err);
      res.status(500).json({ success: false, message: err?.message || 'Server error initiating payment.' });
    }
  }
);

// Backwards-compatible alias for any in-flight client requests
app.post('/api/payments/flutterwave-initiate', (req: Request, res: Response) => {
  // Delegate directly to the Relworx initiation handler
  (app._router.handle as any)({ ...req, url: '/api/payments/relworx-initiate' }, res);
});

/**
 * Official Relworx Webhook Listener
 * Documentation: https://payments.relworx.com/docs
 *
 * Strict Audited Security:
 * 1. Signature Authentication: Verifies Relworx-Signature header with timestamp replay protection
 * 2. Exact Amount Matching: paid amount MUST match expected order amount exactly
 * 3. Exact Currency Matching: currency must be 'UGX'
 * 4. Late Payment Race Handler: If customer approved on handset but webhook was delayed past the
 *    10-minute expiry, the system safely recovers and issues tickets
 * 5. Idempotent Processing: duplicate webhooks never generate duplicate tickets
 */
app.post('/api/payments/relworx-webhook', async (req: Request, res: Response) => {
  try {
    const signature = (req.headers['relworx-signature'] ||
      req.headers['Relworx-Signature'] ||
      req.headers['signature']) as string | undefined;

    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // 1. Verify signature authenticity against official Relworx documentation
    const sigCheck = RelworxService.verifyWebhookSignature(signature, req.body, fullUrl);
    if (!sigCheck.valid) {
      console.warn(`[Relworx Webhook Rejected] Signature verification failed: ${sigCheck.reason}`);
      return res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
    }

    const body = req.body || {};
    const rawStatus = String(body.status || body.transaction_status || '').toLowerCase();
    const orderRef = String(body.customer_reference || body.reference || body.order_ref || '').trim();
    const internalRef = body.internal_reference ? String(body.internal_reference).trim() : null;
    const reportedAmount = body.amount !== undefined ? Number(body.amount) : undefined;
    const reportedCurrency = body.currency ? String(body.currency).toUpperCase() : undefined;

    if (!orderRef) {
      console.warn('[Relworx Webhook] Payload missing order reference identifier.');
      return res.status(200).json({ status: 'ignored', message: 'Missing order reference' });
    }

    // Handle payment success
    if (['success', 'successful', 'completed', 'paid'].includes(rawStatus)) {
      // If live API key is configured, perform independent server-to-server verification check
      if (RelworxService.isConfigured()) {
        const directVerify = await RelworxService.checkRequestStatus({
          internalReference: internalRef || undefined,
          reference: orderRef,
        });

        if (!directVerify.success || directVerify.status !== 'success') {
          console.warn(`[Relworx Webhook] Independent API verification did not confirm success: status=${directVerify.status}`);
          return res.status(200).json({ status: 'unverified', message: 'Relworx status check not confirmed' });
        }

        // Verify currency
        if (directVerify.currency && directVerify.currency.toUpperCase() !== 'UGX') {
          console.error(`[Relworx Webhook Security Alert] Currency mismatch: ${directVerify.currency}`);
          return res.status(400).json({ status: 'error', message: 'Currency mismatch' });
        }
      }

      // Idempotently process payment confirmation with exact amount matching and late-payment race handler
      const markResult = await SupabaseServerService.markOrderAsPaid(orderRef, {
        amount: reportedAmount,
        currency: reportedCurrency || 'UGX',
        relworx_internal_ref: internalRef,
        relworx: body,
      });

      if (!markResult.success) {
        console.error(`[Relworx Webhook Failed to Mark Paid] ${markResult.error}`);
        // If amount mismatch, respond 400 Bad Request
        if (markResult.error?.includes('AMOUNT_MISMATCH') || markResult.error?.includes('CURRENCY_MISMATCH')) {
          return res.status(400).json({ status: 'error', message: markResult.error });
        }
        return res.status(500).json({ status: 'error', message: markResult.error });
      }

      return res.status(200).json({
        status: 'success',
        message: 'Order verified and tickets issued',
        issuedCount: markResult.issuedCount,
      });
    }

    // Handle payment failure or cancellation
    if (['failed', 'declined', 'cancelled', 'rejected', 'expired'].includes(rawStatus)) {
      await SupabaseServerService.releaseReservationByOrderRef(orderRef);
      return res.status(200).json({ status: 'success', message: 'Payment failed; reservation released' });
    }

    // Acknowledge other non-terminal events
    res.status(200).json({ status: 'ignored' });
  } catch (err: any) {
    console.error('[Relworx Webhook Exception]', err);
    res.status(500).json({ status: 'error', message: err?.message });
  }
});

/**
 * Order Status & Polling Route
 * Frontend polls this while customer approves USSD prompt on their handset.
 * Only returns tickets and QR tokens when status is confirmed 'paid'!
 */
app.get(
  '/api/orders/:orderRef/status',
  rateLimit({ windowMs: 60 * 1000, max: 90 }),
  async (req: Request, res: Response) => {
    try {
      const orderRef = String(req.params.orderRef || '').trim();

      // Validate order reference format
      if (!/^PP-[A-Za-z0-9_\-]+$/.test(orderRef) || orderRef.length > 50) {
        return res.status(400).json({ success: false, message: 'Invalid order reference format.' });
      }

      const status = await SupabaseServerService.getOrderStatus(orderRef);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Error checking order status.' });
    }
  }
);

/**
 * Attendee Self-Service Ticket Lookup
 * Allows customer to retrieve confirmed tickets by entering their phone number or order reference.
 * Rate limited to prevent phone number harvesting.
 */
app.post(
  '/api/orders/lookup',
  rateLimit({ windowMs: 60 * 1000, max: 15 }),
  async (req: Request, res: Response) => {
    try {
      const contact = String(req.body.contact || '').trim();
      if (!contact || contact.length < 4 || contact.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid phone number or order reference.',
        });
      }

      const tickets = await SupabaseServerService.lookupTicketsByContact(contact);
      res.json({ success: true, count: tickets.length, tickets });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Error searching for tickets.' });
    }
  }
);

/**
 * Single-Scan QR Gate Verification:
 * Checks token against database and atomically marks checked_in_at
 * Protected by Admin / Gate Staff Passcode to prevent unauthorized public scanning
 */
app.post(
  '/api/tickets/verify-checkin',
  requireAdminAuth,
  rateLimit({ windowMs: 60 * 1000, max: 60 }),
  async (req: Request, res: Response) => {
    try {
      const tokenOrNumber = String(req.body.tokenOrNumber || '').trim();
      if (!tokenOrNumber || tokenOrNumber.length > 60) {
        return res.status(400).json({ status: 'INVALID', message: 'Missing or invalid token / ticket number.' });
      }

      const result = await SupabaseServerService.verifyAndCheckIn(tokenOrNumber);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ status: 'INVALID', message: err?.message || 'Verification error' });
    }
  }
);

// ============================================================
// ADMIN API ENDPOINTS (Protected by Passcode)
// ============================================================

/**
 * Admin Passcode Verification Endpoint
 * Validates passcode and resets lockout on success
 */
app.post('/api/admin/verify-passcode', requireAdminAuth, (req: Request, res: Response) => {
  res.json({ success: true, message: 'Admin passcode verified successfully.' });
});

/**
 * Health Check & Diagnostics (Supabase + Relworx + Admin Auth)
 * Never exposes secrets; returns boolean status
 */
app.get('/api/admin/health', async (req: Request, res: Response) => {
  const health = await SupabaseServerService.checkConnection();
  res.json({
    supabaseConnected: health.connected,
    project: 'Poolparty',
    table: 'public.tickets',
    totalRecordsFound: health.count,
    relworxConfigured: RelworxService.isConfigured(),
    relworxAccount: RelworxService.getAccountNo() ? 'Configured' : 'Using default',
    adminPasscodeConfigured: Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0),
    error: health.error,
  });
});

/**
 * Get all 70 tickets for authenticated dashboard
 */
app.get('/api/admin/tickets', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const tickets = await SupabaseServerService.getAllTicketsAdmin();
    res.json({ success: true, tickets });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

/**
 * Get all Orders for authenticated dashboard
 */
app.get('/api/admin/orders', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const orders = await SupabaseServerService.getAllOrdersAdmin();
    res.json({ success: true, orders });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

/**
 * Admin Trigger: Manually verify pending transaction with Relworx API
 */
app.post('/api/admin/verify-relworx-transaction', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const orderRef = String(req.body.orderRef || '').trim();
    if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef required' });

    const result = await SupabaseServerService.verifyRelworxOrderDirectly(orderRef);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message });
  }
});

// Backwards-compatible admin alias
app.post('/api/admin/verify-flw-transaction', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const orderRef = String(req.body.orderRef || '').trim();
    if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef required' });
    const result = await SupabaseServerService.verifyRelworxOrderDirectly(orderRef);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message });
  }
});

/**
 * Record physical staff cash/POS sale
 */
app.post('/api/admin/physical-sale', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { category, quantity, buyerName, buyerEmail, buyerPhone } = req.body || {};
    const result = await SupabaseServerService.recordPhysicalSaleAdmin({
      category,
      quantity: parseInt(String(quantity), 10) || 1,
      buyerName: String(buyerName || '').trim(),
      buyerEmail: String(buyerEmail || '').trim(),
      buyerPhone: String(buyerPhone || '').trim(),
    });

    if (!result.success) {
      return res.status(409).json(result);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message });
  }
});

/**
 * Confirm payment for online reservation manually (Staff fallback)
 */
app.post('/api/admin/confirm-payment', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const ticketId = String(req.body.ticketId || '').trim();
    const ok = await SupabaseServerService.confirmPaymentAdmin(ticketId);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

/**
 * Release or cancel ticket
 */
app.post('/api/admin/release-ticket', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const ticketId = String(req.body.ticketId || '').trim();
    const ok = await SupabaseServerService.releaseTicketAdmin(ticketId);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});
