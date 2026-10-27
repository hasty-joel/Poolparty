import express from 'express';
import dotenv from 'dotenv';
import { SupabaseServerService, sanitizeCheckInTicket, normalizeStrictOrderRef } from './supabaseServer.js';
import { RelworxService, sanitizeDiagnosticText } from './relworxService.js';
import { MtnMoMoService } from './mtnMoMoService.js';
import { GateSecurity, extractClientIp, safeCompareSecret, type StaffRole } from './gateSecurity.js';

dotenv.config();

const SERVERLESS_ROUTE_PREFIXES = ['/inventory/', '/payments/', '/orders/', '/tickets/', '/admin/', '/gate/'];

export function createExpressApp() {
  const app = express();
  app.use(
    express.json({
      limit: '256kb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );

  // Normalize URLs if a serverless rewrite ever strips the leading `/api` prefix
  app.use((req, _res, next) => {
    if (!req.url.startsWith('/api/') && SERVERLESS_ROUTE_PREFIXES.some((p) => req.url.startsWith(p))) {
      req.url = `/api${req.url}`;
    }
    next();
  });

  // Master admin authorization check (strictly excludes gate_staff sessions & credentials)
  const getAdminPasscode = () => GateSecurity.getConfiguredAdminPasscode();

  const extractRawBearerOrAdminHeader = (req: express.Request): string => {
    const authHeader = req.headers.authorization;
    const adminKey = req.headers['x-admin-key'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    if (typeof adminKey === 'string') {
      return adminKey.trim();
    }
    return '';
  };

  const recordAdminAuthFailure = (clientIp: string, res: express.Response): boolean => {
    const rl = GateSecurity.consumeRateLimit({
      namespace: 'admin_auth_failures',
      key: clientIp,
      maxRequests: 5,
      windowMs: 15 * 60 * 1000,
    });
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      res.status(429).json({
        success: false,
        error: 'RATE_LIMITED',
        retryAfterSeconds: rl.retryAfterSeconds,
        message: 'Too many failed admin authentication attempts. Please wait before trying again.',
      });
      return true;
    }
    return false;
  };

  const requireAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const clientIp = extractClientIp(req);
    const rateCheck = GateSecurity.isRateLimited({
      namespace: 'admin_auth_failures',
      key: clientIp,
      maxRequests: 5,
    });
    if (rateCheck.limited) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMITED',
        retryAfterSeconds: rateCheck.retryAfterSeconds,
        message: 'Too many failed admin authentication attempts. Please wait before trying again.',
      });
    }

    // 1. Check if caller presented a signed session token (cookie or Bearer ppgs1...)
    const sessionToken = GateSecurity.extractSessionTokenFromRequest(req);
    if (sessionToken) {
      const verified = GateSecurity.verifySessionToken(sessionToken);
      if (verified.valid && verified.payload) {
        if (verified.payload.role === 'admin') {
          if (!GateSecurity.isAdminPasscodeConfigured()) {
            return res.status(503).json({
              success: false,
              error: 'ADMIN_AUTH_NOT_CONFIGURED',
              message: 'Admin authentication is not configured on the server.',
            });
          }
          (req as any).staffRole = 'admin' as StaffRole;
          return next();
        }
        // Explicitly block gate_staff sessions from accessing any admin endpoint or activating tickets (role check, not auth failure)
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: 'Forbidden: Gate staff sessions cannot access admin functions or activate tickets.',
        });
      }

      if (verified.reason === 'EXPIRED' || verified.reason === 'REVOKED') {
        GateSecurity.clearSessionCookie(res, req);
        return res.status(401).json({
          success: false,
          error: 'SESSION_EXPIRED',
          message: 'Admin session has expired or signed out. Please sign in again.',
        });
      }

      if (recordAdminAuthFailure(clientIp, res)) return;
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid Admin passcode required.',
      });
    }

    // 2. Check raw admin Bearer / x-admin-key header
    const token = extractRawBearerOrAdminHeader(req);
    const gatePasscode = GateSecurity.getConfiguredGatePasscode();
    const adminPasscode = getAdminPasscode();

    // Explicitly block raw GATE_PASSCODE on admin routes (role separation, not failed brute-force guess)
    if (token && gatePasscode && safeCompareSecret(token, gatePasscode) && (!adminPasscode || !safeCompareSecret(token, adminPasscode))) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Forbidden: Gate staff credentials cannot access admin functions or activate tickets.',
      });
    }

    // Fail closed whenever ADMIN_PASSCODE is missing or invalid (< 12 chars or weak placeholder)
    if (!GateSecurity.isAdminPasscodeConfigured() || !adminPasscode) {
      if (token && recordAdminAuthFailure(clientIp, res)) return;
      return res.status(503).json({
        success: false,
        error: 'ADMIN_AUTH_NOT_CONFIGURED',
        message: 'Admin authentication is not configured on the server.',
      });
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid Admin passcode required.',
      });
    }

    if (!safeCompareSecret(token, adminPasscode)) {
      if (recordAdminAuthFailure(clientIp, res)) return;
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid Admin passcode required.',
      });
    }

    GateSecurity.clearRateLimitKey('admin_auth_failures', clientIp);
    (req as any).staffRole = 'admin' as StaffRole;
    next();
  };

  /**
   * Gate check-in authorization:
   * Allows ONLY:
   *   1. Valid, non-expired, non-revoked signed session (gate_staff or admin) via HttpOnly cookie or Bearer token
   *   2. Valid organizer admin credentials (Authorization: Bearer <ADMIN_PASSCODE> / x-admin-key) when strongly configured
   */
  const requireGateOrAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const clientIp = extractClientIp(req);
    const sessionToken = GateSecurity.extractSessionTokenFromRequest(req);
    if (sessionToken) {
      const verified = GateSecurity.verifySessionToken(sessionToken);
      if (verified.valid && verified.payload) {
        (req as any).staffRole = verified.payload.role;
        return next();
      }

      if (verified.reason === 'EXPIRED' || verified.reason === 'REVOKED') {
        GateSecurity.clearSessionCookie(res, req);
        return res.status(401).json({
          success: false,
          status: 'UNAUTHORIZED',
          error: 'SESSION_EXPIRED',
          message: 'Gate staff session has expired or signed out. Please sign in again.',
        });
      }

      if (recordAdminAuthFailure(clientIp, res)) return;
      return res.status(401).json({
        success: false,
        status: 'UNAUTHORIZED',
        error: 'UNAUTHORIZED',
        message: 'Unauthorized: Valid gate staff session or admin authorization required to check in tickets.',
      });
    }

    const rawToken = extractRawBearerOrAdminHeader(req);
    if (rawToken && !rawToken.startsWith(`${GateSecurity.TOKEN_PREFIX}.`)) {
      const rateCheck = GateSecurity.isRateLimited({
        namespace: 'admin_auth_failures',
        key: clientIp,
        maxRequests: 5,
      });
      if (rateCheck.limited) {
        res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
        return res.status(429).json({
          success: false,
          status: 'UNAUTHORIZED',
          error: 'RATE_LIMITED',
          retryAfterSeconds: rateCheck.retryAfterSeconds,
          message: 'Too many failed authentication attempts. Please wait before trying again.',
        });
      }

      const adminPasscode = getAdminPasscode();
      if (adminPasscode && GateSecurity.isAdminPasscodeConfigured() && safeCompareSecret(rawToken, adminPasscode)) {
        GateSecurity.clearRateLimitKey('admin_auth_failures', clientIp);
        (req as any).staffRole = 'admin' as StaffRole;
        return next();
      }

      if (recordAdminAuthFailure(clientIp, res)) return;
    }

    return res.status(401).json({
      success: false,
      status: 'UNAUTHORIZED',
      error: 'UNAUTHORIZED',
      message: 'Unauthorized: Valid gate staff session or admin authorization required to check in tickets.',
    });
  };

  // ============================================================
  // PUBLIC API ENDPOINTS (Preserves RLS & Privacy)
  // ============================================================

  /**
   * Public available ticket counts:
   * Returns ONLY live database counts; never exposes buyer names, emails, phones, or QR tokens.
   */
  app.get('/api/inventory/counts', async (_req, res) => {
    try {
      const result = await SupabaseServerService.getPublicCounts();
      if (!result.success || !result.counts) {
        return res.status(503).json({
          success: false,
          error: result.error || 'Unable to connect to database or read inventory counts.',
        });
      }
      res.json(result);
    } catch {
      res.status(500).json({ success: false, error: 'Server error reading ticket inventory.' });
    }
  });

  /**
   * MTN Mobile Money Merchant Configuration:
   * Returns configured merchant code, name, and instructions.
   * If MTN_MERCHANT_CODE is missing, returns clear configuration notice.
   */
  app.get('/api/payments/mtn-config', (_req, res) => {
    try {
      const config = MtnMoMoService.getPublicConfig();
      res.json({ success: true, ...config });
    } catch {
      res.status(500).json({ success: false, error: 'Could not load MTN configuration' });
    }
  });

  /**
   * MTN Mobile Money Pass Reservation:
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically locks tickets for 15 minutes
   * 3. Creates pending order and returns merchant payment instructions
   */
  app.post('/api/payments/mtn-reserve', async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone } = req.body || {};
      if (!category || !quantity || !buyerName || !buyerEmail || !buyerPhone) {
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields: full name, email, phone number, category, and quantity.',
          error: 'VALIDATION_ERROR',
        });
      }

      const result = await SupabaseServerService.initiateMtnMerchantReservation({
        category,
        quantity: Number(quantity),
        buyerName: String(buyerName).trim(),
        buyerEmail: String(buyerEmail).trim(),
        buyerPhone: String(buyerPhone).trim(),
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Server error while reserving passes.' });
    }
  });

  /**
   * MTN Mobile Money Transaction Submission:
   * Customer submits their MTN Transaction ID after paying to the merchant code.
   * Validates format, checks for duplicates, and sets verification_status = 'pending_verification'.
   * DOES NOT issue tickets or mark as paid!
   */
  app.post('/api/payments/mtn-submit', async (req, res) => {
    try {
      const { orderRef, mtnTransactionId, payerPhone, notes } = req.body || {};
      if (!orderRef || !mtnTransactionId || !payerPhone) {
        return res.status(400).json({
          success: false,
          message: 'Order reference, MTN Transaction ID, and payer phone number are required.',
          error: 'VALIDATION_ERROR',
        });
      }

      const txCheck = MtnMoMoService.sanitizeTransactionId(String(mtnTransactionId));
      if (!txCheck.valid) {
        return res.status(400).json({
          success: false,
          message: txCheck.error || 'Invalid MTN Transaction ID.',
          error: 'INVALID_TRANSACTION_ID',
        });
      }

      const result = await SupabaseServerService.submitMtnTransaction({
        orderRef: String(orderRef).trim(),
        mtnTransactionId: txCheck.cleaned,
        payerPhone: String(payerPhone).trim(),
        notes: notes ? String(notes).trim() : undefined,
      });

      if (!result.success) {
        const statusCode = result.error === 'DUPLICATE_TRANSACTION_ID' ? 409 : 400;
        return res.status(statusCode).json(result);
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Server error while submitting payment.' });
    }
  });

  /**
   * Shared payment initiation handler (Relworx Uganda Mobile Money - MTN & Airtel)
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically reserves tickets in Supabase with 10-minute expiry
   * 3. Triggers Relworx Mobile Money push to customer handset
   */
  const handleInitiatePayment = async (req: express.Request, res: express.Response) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone, network, idempotencyKey } = req.body || {};
      const headerIdempotencyKey =
        typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'] : undefined;

      if (!category || quantity === undefined || quantity === null || !buyerName || !buyerEmail || !buyerPhone || !network) {
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields: full name, email, phone number, pass tier, quantity, and network (MTN or Airtel).',
          error: 'VALIDATION_ERROR',
        });
      }

      if (category !== 'VIP' && category !== 'ORDINARY') {
        return res.status(400).json({
          success: false,
          message: 'Invalid ticket category. Must be VIP or ORDINARY.',
          error: 'VALIDATION_ERROR',
        });
      }

      if (network !== 'MTN' && network !== 'AIRTEL') {
        return res.status(400).json({
          success: false,
          message: 'Network must be MTN or AIRTEL.',
          error: 'VALIDATION_ERROR',
        });
      }

      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
        return res.status(400).json({
          success: false,
          message: 'Quantity must be between 1 and 10 tickets.',
          error: 'VALIDATION_ERROR',
        });
      }

      if (typeof buyerName !== 'string' || buyerName.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your full name as it will appear on your pass.',
          error: 'VALIDATION_ERROR',
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof buyerEmail !== 'string' || !emailRegex.test(buyerEmail.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address.',
          error: 'VALIDATION_ERROR',
        });
      }

      const phoneCheck = RelworxService.formatUgandaMsisdn(String(buyerPhone));
      if (!phoneCheck.valid) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid Uganda Mobile Money number (e.g. 0775 198 484 or +256 701 234567).',
          error: 'VALIDATION_ERROR',
        });
      }

      const result = await SupabaseServerService.initiateRelworxPayment({
        category,
        quantity: qty,
        buyerName: buyerName.trim(),
        buyerEmail: buyerEmail.trim(),
        buyerPhone: String(buyerPhone).trim(),
        network,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : headerIdempotencyKey,
      });

      if (!result.success) {
        const errCode = result.error || '';
        const providerCode = result.code || '';

        if (result.retryAfterSeconds && result.retryAfterSeconds > 0) {
          res.setHeader('Retry-After', String(result.retryAfterSeconds));
        }

        if (errCode === 'VALIDATION_ERROR' || errCode === 'INVALID_PHONE_NUMBER') {
          return res.status(400).json(result);
        }
        if (errCode === 'INSUFFICIENT_INVENTORY') {
          return res.status(409).json(result);
        }
        if (errCode === 'RATE_LIMITED' || providerCode === 'RATE_LIMITED') {
          return res.status(429).json(result);
        }
        if (
          errCode === 'PAYMENT_PROVIDER_UNAVAILABLE' ||
          providerCode === 'API_DISABLED' ||
          errCode === 'SUPABASE_NOT_CONFIGURED' ||
          errCode === 'RELWORX_NOT_CONFIGURED' ||
          errCode === 'DATABASE_ERROR' ||
          errCode === 'SCHEMA_MISMATCH'
        ) {
          return res.status(503).json(result);
        }
        return res.status(502).json(result);
      }

      return res.status(200).json(result);
    } catch (err: any) {
      console.error('[Payment Initiation Route Error]', sanitizeDiagnosticText(err?.message || ''));
      return res.status(500).json({
        success: false,
        message: 'Unexpected server error while initiating payment. Please try again.',
        error: 'SERVER_ERROR',
      });
    }
  };

  app.post('/api/payments/relworx-initiate', handleInitiatePayment);
  app.post('/api/payments/flutterwave-initiate', handleInitiatePayment);

  /**
   * Official Relworx Webhook Listener
   * - Fails closed when webhook verification secret or Relworx status API is not configured.
   * - Verifies HMAC-SHA256 signature against raw body + replay window.
   * - Cross-verifies payment status, currency ('UGX'), and exact order amount against stored order before marking paid.
   */
  app.post('/api/payments/relworx-webhook', async (req, res) => {
    try {
      if (!RelworxService.isWebhookConfigured()) {
        console.error('[Relworx Webhook] Rejected webhook: RELWORX_WEBHOOK_SECRET is not configured.');
        return res.status(503).json({
          status: 'error',
          error: 'WEBHOOK_NOT_CONFIGURED',
          message: 'Webhook verification is not configured on the server.',
        });
      }

      const signature = (req.headers['relworx-signature'] ||
        req.headers['Relworx-Signature'] ||
        req.headers['signature']) as string | undefined;

      if (!RelworxService.verifyWebhookSignature(signature, req.body, (req as any).rawBody)) {
        console.warn('[Relworx Webhook] Unauthorized webhook signature attempt rejected.');
        return res.status(401).json({ status: 'error', error: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' });
      }

      const body = req.body || {};
      const rawStatus = String(body.status || body.request_status || body.transaction_status || '').toLowerCase();
      const rawOrderRef = body.customer_reference || body.reference || body.order_ref;
      const internalRef = typeof body.internal_reference === 'string' ? body.internal_reference.trim() : undefined;
      const webhookAmount =
        body.amount !== undefined && body.amount !== null && String(body.amount).trim() !== ''
          ? Number(body.amount)
          : undefined;
      const webhookCurrency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : undefined;

      const refCheck = normalizeStrictOrderRef(String(rawOrderRef || ''));
      if (!refCheck.valid) {
        return res.status(400).json({ status: 'error', error: 'INVALID_ORDER_REF', message: 'Missing or invalid order reference' });
      }
      const orderRef = refCheck.orderRef;

      if (['success', 'successful', 'completed', 'paid'].includes(rawStatus)) {
        if (!RelworxService.isConfigured()) {
          console.error('[Relworx Webhook] Rejected paid transition: Relworx API verification credentials not configured.');
          return res.status(503).json({
            status: 'error',
            error: 'RELWORX_NOT_CONFIGURED',
            message: 'Payment provider status verification is not configured on the server.',
          });
        }

        if (webhookCurrency && webhookCurrency !== 'UGX') {
          return res.status(400).json({ status: 'error', error: 'INVALID_CURRENCY', message: 'Invalid currency; expected UGX' });
        }

        const storedOrder = await SupabaseServerService.getOrderForPaymentVerification(orderRef);
        if (storedOrder.error === 'SUPABASE_NOT_CONFIGURED' || storedOrder.error === 'DATABASE_ERROR') {
          return res.status(503).json({
            status: 'error',
            error: storedOrder.error,
            message: 'Unable to load stored order for webhook verification.',
          });
        }
        if (!storedOrder.found || !storedOrder.order) {
          return res.status(404).json({
            status: 'error',
            error: 'ORDER_NOT_FOUND',
            message: 'Order reference was not found.',
          });
        }

        const order = storedOrder.order;
        const expectedAmountUgx = Math.round(Number(order.total_amount_ugx));

        if (webhookAmount !== undefined && (!Number.isFinite(webhookAmount) || Math.round(webhookAmount) !== expectedAmountUgx)) {
          return res.status(400).json({
            status: 'error',
            error: 'AMOUNT_MISMATCH',
            message: 'Webhook payment amount does not match the stored order total.',
          });
        }

        const verification = await RelworxService.checkRequestStatus({
          internalReference: internalRef || order.relworx_internal_ref || undefined,
          reference: order.order_ref,
        });

        if (!verification.success || verification.status !== 'success') {
          console.warn(
            `[Relworx Webhook] Provider status check did not confirm success: status=${verification.status}`
          );
          return res.status(409).json({
            status: 'unverified',
            error: 'PAYMENT_NOT_CONFIRMED',
            message: 'Provider status verification did not confirm successful payment.',
          });
        }

        const verifiedCurrency = verification.currency ? String(verification.currency).toUpperCase() : 'UGX';
        if (verifiedCurrency !== 'UGX') {
          return res.status(400).json({ status: 'error', error: 'INVALID_CURRENCY', message: 'Invalid currency' });
        }

        if (
          verification.amount === undefined ||
          verification.amount === null ||
          !Number.isFinite(Number(verification.amount)) ||
          Math.round(Number(verification.amount)) !== expectedAmountUgx
        ) {
          return res.status(400).json({
            status: 'error',
            error: 'AMOUNT_MISMATCH',
            message: 'Verified provider amount does not match stored order total.',
          });
        }

        if (verification.reference && verification.reference.trim().toUpperCase() !== order.order_ref) {
          return res.status(400).json({
            status: 'error',
            error: 'ORDER_REF_MISMATCH',
            message: 'Verified provider reference does not match order reference.',
          });
        }

        const marked = await SupabaseServerService.markOrderAsPaid(order.order_ref, {
          relworx: verification,
          relworx_internal_ref: verification.internal_reference || internalRef || order.relworx_internal_ref,
          amount: expectedAmountUgx,
          currency: 'UGX',
        });

        if (!marked) {
          return res.status(503).json({
            status: 'error',
            error: 'DATABASE_ERROR',
            message: 'Could not persist verified payment state.',
          });
        }

        return res.status(200).json({ status: 'success', message: 'Order payment verified and tickets issued' });
      }

      if (['failed', 'declined', 'cancelled', 'expired', 'rejected'].includes(rawStatus)) {
        if (!RelworxService.isConfigured()) {
          return res.status(503).json({
            status: 'error',
            error: 'RELWORX_NOT_CONFIGURED',
            message: 'Payment provider status verification is not configured on the server.',
          });
        }

        const storedOrder = await SupabaseServerService.getOrderForPaymentVerification(orderRef);
        if (!storedOrder.found || !storedOrder.order) {
          return res.status(404).json({ status: 'error', error: 'ORDER_NOT_FOUND', message: 'Order reference not found' });
        }

        if (storedOrder.order.status === 'paid') {
          return res.status(200).json({ status: 'ignored', message: 'Order is already confirmed paid' });
        }

        const verification = await RelworxService.checkRequestStatus({
          internalReference: internalRef || storedOrder.order.relworx_internal_ref || undefined,
          reference: storedOrder.order.order_ref,
        });

        if (verification.status !== 'failed') {
          return res.status(409).json({
            status: 'unverified',
            error: 'FAILURE_NOT_CONFIRMED',
            message: 'Provider did not confirm failed payment status.',
          });
        }

        await SupabaseServerService.releaseReservationByOrderRef(orderRef, 'failed');
        return res.status(200).json({ status: 'success', message: 'Order marked failed and inventory released' });
      }

      res.status(200).json({ status: 'ignored' });
    } catch (err: any) {
      console.error(
        '[Relworx Webhook Error]',
        GateSecurity.redactServerSecrets(sanitizeDiagnosticText(err?.message || ''))
      );
      res.status(500).json({ status: 'error', message: 'Webhook processing error' });
    }
  });

  /**
   * Order Status & Polling Route
   * Frontend polls this while customer approves USSD prompt on their handset.
   * Only returns tickets and QR tokens when status is confirmed 'paid' in Supabase!
   */
  app.get('/api/orders/:orderRef/status', async (req, res) => {
    try {
      const { orderRef } = req.params;
      if (!orderRef) {
        return res.status(400).json({ success: false, message: 'Order reference required.' });
      }

      const status = await SupabaseServerService.getOrderStatus(orderRef);
      res.json(status);
    } catch {
      res.status(500).json({ success: false, message: 'Error checking order status.' });
    }
  });

  /**
   * Attendee Self-Service Order Lookup (Rate-Limited + Ownership Verified)
   * - Requires strict Uganda phone number OR exact hyphenated order reference
   * - Requires second ownership verification factor (checkout email, phone, or order reference)
   * - Never exposes raw QR tokens, buyer emails, buyer phones, or unrelated buyers' records
   */
  app.post('/api/orders/lookup', async (req, res) => {
    try {
      const clientIp = extractClientIp(req);
      const rl = GateSecurity.consumeRateLimit({
        namespace: 'order_lookup',
        key: clientIp,
        maxRequests: 10,
        windowMs: 15 * 60 * 1000,
      });

      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSeconds));
        return res.status(429).json({
          success: false,
          count: 0,
          tickets: [],
          error: 'RATE_LIMITED',
          retryAfterSeconds: rl.retryAfterSeconds,
          message: 'Too many lookup requests. Please wait a few minutes before trying again.',
        });
      }

      const body = req.body || {};
      const primaryRaw =
        typeof body.contact === 'string' && body.contact.trim()
          ? body.contact.trim()
          : typeof body.orderRef === 'string' && body.orderRef.trim()
          ? body.orderRef.trim()
          : typeof body.phone === 'string' && body.phone.trim()
          ? body.phone.trim()
          : '';

      let verificationRaw =
        typeof body.verification === 'string' && body.verification.trim()
          ? body.verification.trim()
          : typeof body.email === 'string' && body.email.trim()
          ? body.email.trim()
          : '';

      if (!verificationRaw && typeof body.orderRef === 'string' && typeof body.phone === 'string') {
        verificationRaw = primaryRaw === body.orderRef.trim() ? body.phone.trim() : body.orderRef.trim();
      }

      const result = await SupabaseServerService.lookupOrdersVerified({
        contact: primaryRaw,
        verification: verificationRaw,
      });

      const { httpStatus, ...payload } = result;
      return res.status(httpStatus).json(payload);
    } catch {
      return res.status(500).json({
        success: false,
        count: 0,
        tickets: [],
        error: 'SERVER_ERROR',
        message: 'Error searching for tickets.',
      });
    }
  });

  /**
   * Read-Only Public Pass Validity Check (UUID QR Token Only):
   * - Accepts ?token=<qr_token> (or ?qrToken=<qr_token>)
   * - Rate-limited per IP to prevent scraping
   * - Never exposes buyer PII or QR tokens
   * - Never modifies checked_in_at or ticket state
   */
  app.get('/api/tickets/public-status', async (req, res) => {
    try {
      const clientIp = extractClientIp(req);
      const rl = GateSecurity.consumeRateLimit({
        namespace: 'public_ticket_status',
        key: clientIp,
        maxRequests: 30,
        windowMs: 60 * 1000,
      });

      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSeconds));
        return res.status(429).json({
          success: false,
          valid: false,
          status: 'INVALID',
          error: 'RATE_LIMITED',
          message: 'Too many verification checks. Please wait briefly before trying again.',
        });
      }

      const rawToken =
        (typeof req.query.token === 'string' && req.query.token) ||
        (typeof req.query.qrToken === 'string' && req.query.qrToken) ||
        (typeof req.query.verify === 'string' && req.query.verify) ||
        '';

      const result = await SupabaseServerService.getPublicTicketStatusByToken(rawToken);
      const { httpStatus = 200, ...body } = result;
      return res.status(httpStatus).json(body);
    } catch {
      return res.status(500).json({
        success: false,
        valid: false,
        status: 'INVALID',
        message: 'Unable to check pass status right now.',
      });
    }
  });

  // ============================================================
  // GATE STAFF AUTHENTICATION & CHECK-IN ENDPOINTS
  // ============================================================

  /**
   * Exchange server-side GATE_PASSCODE (or ADMIN_PASSCODE) for an expiring signed session.
   * Protected by strict brute-force rate limiting (max 5 failed attempts per 15 minutes per IP).
   */
  app.post('/api/gate/session', (req, res) => {
    try {
      const clientIp = extractClientIp(req);
      const { passcode } = req.body || {};

      if (typeof passcode !== 'string' || !passcode.trim()) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Passcode is required.',
        });
      }

      // Check failed-login rate limit before attempting secret verification
      const rlCheck = GateSecurity.consumeRateLimit({
        namespace: 'gate_login_failures',
        key: clientIp,
        maxRequests: 5,
        windowMs: 15 * 60 * 1000,
      });

      if (!rlCheck.allowed) {
        res.setHeader('Retry-After', String(rlCheck.retryAfterSeconds));
        return res.status(429).json({
          success: false,
          error: 'RATE_LIMITED',
          retryAfterSeconds: rlCheck.retryAfterSeconds,
          message: 'Too many failed gate login attempts. Please wait before trying again.',
        });
      }

      const authCheck = GateSecurity.verifyPasscodeRole(passcode);
      if (!authCheck.matched || !authCheck.role) {
        if (!GateSecurity.isGatePasscodeConfigured()) {
          return res.status(503).json({
            success: false,
            error: 'GATE_AUTH_NOT_CONFIGURED',
            message: 'Gate passcode is not configured on the server (set GATE_PASSCODE) or passcode is invalid.',
          });
        }
        return res.status(401).json({
          success: false,
          error: 'INVALID_PASSCODE',
          message: 'Invalid gate staff passcode.',
        });
      }

      // Successful login resets the failure counter for this IP
      GateSecurity.clearRateLimitKey('gate_login_failures', clientIp);

      const session = GateSecurity.issueSession(authCheck.role);
      GateSecurity.setSessionCookie(res, req, session.sessionToken, session.expiresInSeconds);

      return res.status(200).json({
        success: true,
        authenticated: true,
        role: authCheck.role,
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
        expiresInSeconds: session.expiresInSeconds,
      });
    } catch {
      return res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: 'Unable to create gate session right now.',
      });
    }
  });

  app.get('/api/gate/session', (req, res) => {
    const sessionToken = GateSecurity.extractSessionTokenFromRequest(req);
    if (!sessionToken) {
      return res.status(200).json({ success: true, authenticated: false });
    }
    const verified = GateSecurity.verifySessionToken(sessionToken);
    if (!verified.valid || !verified.payload) {
      GateSecurity.clearSessionCookie(res, req);
      return res.status(200).json({
        success: true,
        authenticated: false,
        reason: verified.reason,
      });
    }
    return res.status(200).json({
      success: true,
      authenticated: true,
      role: verified.payload.role,
      expiresAt: new Date(verified.payload.exp).toISOString(),
    });
  });

  app.post('/api/gate/logout', (req, res) => {
    const sessionToken = GateSecurity.extractSessionTokenFromRequest(req);
    if (sessionToken) {
      GateSecurity.revokeSessionToken(sessionToken);
    }
    GateSecurity.clearSessionCookie(res, req);
    return res.status(200).json({
      success: true,
      message: 'Gate session signed out.',
    });
  });

  app.get('/api/gate/recent-checkins', requireGateOrAdminAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 10;
      const result = await SupabaseServerService.getRecentCheckInsGate(limit);
      if (!result.success) {
        return res.status(503).json(result);
      }
      return res.json(result);
    } catch {
      return res.status(500).json({ success: false, checkIns: [], error: 'Error loading recent check-ins.' });
    }
  });

  /**
   * Single-Scan QR Gate Verification (Authenticated Gate Staff or Admin ONLY):
   * - Protected by requireGateOrAdminAuth + per-IP scan rate limiting
   * - Atomically verifies & sets checked_in_at once
   * - Redacts sensitive fields (qr_token, email, phone, payment refs) for gate_staff role
   */
  app.post('/api/tickets/verify-checkin', requireGateOrAdminAuth, async (req, res) => {
    try {
      const clientIp = extractClientIp(req);
      const rl = GateSecurity.consumeRateLimit({
        namespace: 'gate_checkin',
        key: clientIp,
        maxRequests: 90,
        windowMs: 60 * 1000,
      });

      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSeconds));
        return res.status(429).json({
          status: 'INVALID',
          error: 'RATE_LIMITED',
          message: 'Scan rate limit exceeded. Please wait briefly before scanning again.',
        });
      }

      const { tokenOrNumber } = req.body || {};
      if (!tokenOrNumber || typeof tokenOrNumber !== 'string' || !tokenOrNumber.trim()) {
        return res.status(400).json({ status: 'INVALID', message: 'Missing token or ticket number' });
      }

      const result = await SupabaseServerService.verifyAndCheckIn(tokenOrNumber);
      const httpStatus = result.httpStatus || 200;

      // Unconditionally strip buyer_email, buyer_phone, raw qr_token, order_ref, and payment refs for ALL callers
      if (result.ticket) {
        return res.status(httpStatus).json({
          status: result.status,
          error: result.error,
          message: result.message,
          checkedInAt: result.checkedInAt,
          ticket: sanitizeCheckInTicket(result.ticket),
        });
      }

      return res.status(httpStatus).json({
        status: result.status,
        error: result.error,
        message: result.message,
        checkedInAt: result.checkedInAt,
      });
    } catch (err: any) {
      console.error(
        '[Gate Check-In Route Error]',
        GateSecurity.redactServerSecrets(sanitizeDiagnosticText(err?.message || ''))
      );
      return res.status(500).json({ status: 'INVALID', message: 'Verification error' });
    }
  });

  // ============================================================
  // ADMIN API ENDPOINTS (Protected with requireAdminAuth)
  // ============================================================

  app.get('/api/admin/health', requireAdminAuth, async (_req, res) => {
    const health = await SupabaseServerService.checkConnection();
    res.json({
      supabaseConnected: health.connected,
      project: 'Poolparty',
      table: 'public.tickets',
      totalRecordsFound: health.count,
      ticketsSchemaReady: health.ticketsSchemaReady,
      ordersTableReady: health.ordersTableReady,
      ticketChannelReady: health.ticketChannelReady,
      hardcopyAuditTableReady: health.hardcopyAuditTableReady,
      schemaWarning: health.schemaWarning,
      adminAuthConfigured: GateSecurity.isAdminPasscodeConfigured(),
      gateAuthConfigured: GateSecurity.isGatePasscodeConfigured(),
      gatePasscodeDistinctFromAdmin: GateSecurity.isGatePasscodeDistinctFromAdmin(),
      mtnMerchantConfigured: MtnMoMoService.isConfigured(),
      mtnMerchantCode: MtnMoMoService.isConfigured() ? 'Configured' : 'Missing (MTN_MERCHANT_CODE pending in .env)',
      mtnMerchantName: MtnMoMoService.getMerchantName(),
      relworxConfigured: RelworxService.isConfigured(),
      relworxWebhookConfigured: RelworxService.isWebhookConfigured(),
      relworxStatus: RelworxService.getProviderHealthStatus(),
      relworxAccount: RelworxService.getAccountNo() ? 'Configured' : 'Missing',
      error: health.error,
    });
  });

  app.get('/api/admin/tickets', requireAdminAuth, async (_req, res) => {
    try {
      const result = await SupabaseServerService.getAllTicketsAdmin();
      if (!result.success) {
        return res.status(503).json(result);
      }
      res.json(result);
    } catch {
      res.status(500).json({ success: false, error: 'Error loading tickets.' });
    }
  });

  app.get('/api/admin/orders', requireAdminAuth, async (_req, res) => {
    try {
      const result = await SupabaseServerService.getAllOrdersAdmin();
      if (!result.success) {
        return res.status(503).json(result);
      }
      res.json(result);
    } catch {
      res.status(500).json({ success: false, error: 'Error loading orders.' });
    }
  });

  /**
   * Admin: Verify MTN Mobile Money Merchant Payment
   * Checks against official MTN merchant portal records and activates QR tickets
   * Supports both /api/admin/mtn-verify and legacy alias /api/admin/verify-mtn-payment
   */
  const handleMtnVerify = async (req: express.Request, res: express.Response) => {
    try {
      const { orderRef, adminName, notes } = req.body || {};
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef is required.' });

      const result = await SupabaseServerService.verifyMtnPaymentAdmin({
        orderRef: String(orderRef).trim(),
        adminName: typeof adminName === 'string' ? adminName : 'Admin',
        notes: typeof notes === 'string' ? notes : undefined,
      });

      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch {
      res.status(500).json({ success: false, message: 'Error verifying MTN payment.' });
    }
  };

  app.post('/api/admin/mtn-verify', requireAdminAuth, handleMtnVerify);
  app.post('/api/admin/verify-mtn-payment', requireAdminAuth, handleMtnVerify);

  /**
   * Admin: Reject MTN Mobile Money Merchant Payment
   * Marks order rejected and releases reserved tickets back to inventory
   * Supports both /api/admin/mtn-reject and legacy alias /api/admin/reject-mtn-payment
   */
  const handleMtnReject = async (req: express.Request, res: express.Response) => {
    try {
      const { orderRef, reason, adminName } = req.body || {};
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef is required.' });

      const result = await SupabaseServerService.rejectMtnPaymentAdmin({
        orderRef: String(orderRef).trim(),
        reason: typeof reason === 'string' ? reason : 'Unmatched transaction ID on MTN merchant account',
        adminName: typeof adminName === 'string' ? adminName : 'Admin',
      });

      res.json(result);
    } catch {
      res.status(500).json({ success: false, message: 'Error rejecting payment.' });
    }
  };

  app.post('/api/admin/mtn-reject', requireAdminAuth, handleMtnReject);
  app.post('/api/admin/reject-mtn-payment', requireAdminAuth, handleMtnReject);

  app.post('/api/admin/verify-relworx-transaction', requireAdminAuth, async (req, res) => {
    try {
      const { orderRef } = req.body || {};
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef required' });

      const result = await SupabaseServerService.verifyRelworxOrderDirectly(orderRef);
      res.json(result);
    } catch {
      res.status(500).json({ success: false, message: 'Error verifying transaction.' });
    }
  });

  app.post('/api/admin/verify-flw-transaction', requireAdminAuth, async (req, res) => {
    try {
      const { orderRef } = req.body || {};
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef required' });
      const result = await SupabaseServerService.verifyRelworxOrderDirectly(orderRef);
      res.json(result);
    } catch {
      res.status(500).json({ success: false, message: 'Error verifying transaction.' });
    }
  });

  app.post('/api/admin/physical-sale', requireAdminAuth, async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone } = req.body || {};
      const result = await SupabaseServerService.recordPhysicalSaleAdmin({
        category,
        quantity: parseInt(quantity, 10) || 1,
        buyerName,
        buyerEmail,
        buyerPhone,
      });

      if (!result.success) {
        return res.status(409).json(result);
      }
      res.json(result);
    } catch {
      res.status(500).json({ success: false, message: 'Error recording physical sale.' });
    }
  });

  app.post('/api/admin/confirm-payment', requireAdminAuth, async (req, res) => {
    try {
      const { ticketId } = req.body || {};
      const result = await SupabaseServerService.confirmPaymentAdmin(String(ticketId || ''));
      const { httpStatus, ...payload } = result;
      return res.status(httpStatus).json(payload);
    } catch {
      return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Error confirming payment.' });
    }
  });

  app.post('/api/admin/release-ticket', requireAdminAuth, async (req, res) => {
    try {
      const { ticketId } = req.body || {};
      const result = await SupabaseServerService.releaseTicketAdmin(String(ticketId || ''));
      const { httpStatus, ...payload } = result;
      return res.status(httpStatus).json(payload);
    } catch {
      return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Error releasing ticket.' });
    }
  });

  // ============================================================
  // ADMIN HARDCOPY ACTIVATION & AUDIT LOG ENDPOINTS (Admin Only)
  // ============================================================

  /**
   * Atomically activate a single hardcopy ticket or contiguous ticket-number range,
   * recording seller/agent, timestamp, ticket numbers, and action in public.hardcopy_audit_logs.
   */
  app.post('/api/admin/hardcopy/activate', requireAdminAuth, async (req, res) => {
    try {
      const {
        ticketNumber,
        ticketNumbers,
        category,
        startNumber,
        endNumber,
        startTicketNumber,
        endTicketNumber,
        sellerName,
        agentName,
        adminName,
        batchRef,
        buyerName,
        buyerPhone,
        notes,
      } = req.body || {};

      const result = await SupabaseServerService.activateHardcopyTicketsAdmin({
        ticketNumber: typeof ticketNumber === 'string' ? ticketNumber : undefined,
        ticketNumbers: Array.isArray(ticketNumbers) ? ticketNumbers : undefined,
        category: typeof category === 'string' ? category : undefined,
        startNumber: startNumber !== undefined ? startNumber : startTicketNumber,
        endNumber: endNumber !== undefined ? endNumber : endTicketNumber,
        sellerName: String(sellerName ?? agentName ?? '').trim(),
        performedBy: adminName === undefined ? 'Admin' : String(adminName),
        batchRef: batchRef === undefined ? undefined : String(batchRef),
        buyerName: typeof buyerName === 'string' ? buyerName : undefined,
        buyerPhone: typeof buyerPhone === 'string' ? buyerPhone : undefined,
        notes: typeof notes === 'string' ? notes : undefined,
      });

      if (!result.success) {
        const err = result.error || '';
        if (
          err === 'VALIDATION_ERROR' ||
          err === 'DUPLICATE_TICKET_NUMBERS' ||
          err === 'ONLINE_TICKET_FORBIDDEN' ||
          err === 'OUT_OF_HARDCOPY_RANGE' ||
          err === 'CATEGORY_MISMATCH'
        ) {
          return res.status(400).json(result);
        }
        if (err === 'TICKETS_NOT_FOUND') {
          return res.status(404).json(result);
        }
        if (
          err === 'TICKETS_NOT_AVAILABLE' ||
          err === 'ATOMIC_UPDATE_MISMATCH' ||
          err === 'DATA_INTEGRITY_ERROR'
        ) {
          return res.status(409).json(result);
        }
        if (err === 'SUPABASE_NOT_CONFIGURED' || err === 'SCHEMA_MISMATCH' || err === 'DATABASE_ERROR') {
          return res.status(503).json(result);
        }
        return res.status(500).json(result);
      }

      return res.status(200).json(result);
    } catch (err: any) {
      console.error(
        '[Admin Hardcopy Activate Error]',
        GateSecurity.redactServerSecrets(sanitizeDiagnosticText(err?.message || ''))
      );
      return res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: 'Unexpected error while activating hardcopy tickets.',
      });
    }
  });

  /**
   * Atomically return un-checked-in hardcopy tickets to unactivated stock ('deactivate_return')
   * or permanently void lost/stolen physical passes ('void_cancel') with mandatory audit logging.
   */
  app.post('/api/admin/hardcopy/status', requireAdminAuth, async (req, res) => {
    try {
      const {
        ticketNumber,
        ticketNumbers,
        category,
        startNumber,
        endNumber,
        startTicketNumber,
        endTicketNumber,
        action,
        sellerName,
        agentName,
        adminName,
        batchRef,
        notes,
      } = req.body || {};

      const result = await SupabaseServerService.updateHardcopyTicketsStatusAdmin({
        ticketNumber: typeof ticketNumber === 'string' ? ticketNumber : undefined,
        ticketNumbers: Array.isArray(ticketNumbers) ? ticketNumbers : undefined,
        category: typeof category === 'string' ? category : undefined,
        startNumber: startNumber !== undefined ? startNumber : startTicketNumber,
        endNumber: endNumber !== undefined ? endNumber : endTicketNumber,
        action,
        sellerName: String(sellerName ?? agentName ?? '').trim(),
        performedBy: adminName === undefined ? 'Admin' : String(adminName),
        batchRef: batchRef === undefined ? undefined : String(batchRef),
        notes: typeof notes === 'string' ? notes : undefined,
      });

      if (!result.success) {
        const err = result.error || '';
        if (
          err === 'VALIDATION_ERROR' ||
          err === 'DUPLICATE_TICKET_NUMBERS' ||
          err === 'ONLINE_TICKET_FORBIDDEN' ||
          err === 'OUT_OF_HARDCOPY_RANGE' ||
          err === 'CATEGORY_MISMATCH'
        ) {
          return res.status(400).json(result);
        }
        if (err === 'TICKETS_NOT_FOUND') {
          return res.status(404).json(result);
        }
        if (
          err === 'ALREADY_CHECKED_IN' ||
          err === 'TICKETS_INVALID_STATE' ||
          err === 'ATOMIC_UPDATE_MISMATCH' ||
          err === 'DATA_INTEGRITY_ERROR'
        ) {
          return res.status(409).json(result);
        }
        if (err === 'SUPABASE_NOT_CONFIGURED' || err === 'SCHEMA_MISMATCH' || err === 'DATABASE_ERROR') {
          return res.status(503).json(result);
        }
        return res.status(500).json(result);
      }

      return res.status(200).json(result);
    } catch (err: any) {
      console.error(
        '[Admin Hardcopy Status Error]',
        GateSecurity.redactServerSecrets(sanitizeDiagnosticText(err?.message || ''))
      );
      return res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: 'Unexpected error while updating hardcopy ticket status.',
      });
    }
  });

  app.get('/api/admin/hardcopy/audit-logs', requireAdminAuth, async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const result = await SupabaseServerService.getHardcopyAuditLogsAdmin(limit);
      if (!result.success) {
        return res.status(503).json(result);
      }
      return res.status(200).json(result);
    } catch {
      return res.status(500).json({
        success: false,
        logs: [],
        error: 'SERVER_ERROR',
        message: 'Unable to fetch hardcopy audit logs.',
      });
    }
  });

  app.get('/api/admin/hardcopy/summary', requireAdminAuth, async (_req, res) => {
    try {
      const result = await SupabaseServerService.getChannelInventorySummaryAdmin();
      if (!result.success) {
        return res.status(503).json(result);
      }
      return res.status(200).json(result);
    } catch {
      return res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: 'Unable to fetch channel inventory summary.',
      });
    }
  });

  // Always return JSON for unmatched `/api/*` routes (never HTML)
  app.use('/api/*', (_req, res) => {
    res.status(404).json({
      success: false,
      message: 'API endpoint not found.',
      error: 'NOT_FOUND',
    });
  });

  // Sanitized JSON Express error handler (handles malformed JSON bodies, etc.)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }
    if (req.url.startsWith('/api')) {
      const status = err?.type === 'entity.parse.failed' ? 400 : 500;
      const message = status === 400 ? 'Invalid JSON request payload.' : 'Unexpected server error.';
      return res.status(status).json({ success: false, message, error: 'SERVER_ERROR' });
    }
    next(err);
  });

  return app;
}
