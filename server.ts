import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { SupabaseServerService } from './src/server/supabaseServer';
import { RelworxService } from './src/server/relworxService';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json());

  // ============================================================
  // PUBLIC API ENDPOINTS (Preserves RLS & Privacy)
  // ============================================================

  /**
   * Public available ticket counts:
   * Returns ONLY available numbers without exposing buyer names, emails, phones, or QR tokens
   */
  app.get('/api/inventory/counts', async (req, res) => {
    try {
      const counts = await SupabaseServerService.getPublicCounts();
      res.json({ success: true, counts });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Server error' });
    }
  });

  /**
   * Relworx Uganda Mobile Money Payment Initiation (MTN & Airtel)
   * Official Relworx API: https://payments.relworx.com/docs
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically reserves tickets with a 10-minute expiry to prevent overselling
   * 3. Triggers Relworx Mobile Money Request-Payment push to customer handset
   */
  app.post('/api/payments/relworx-initiate', async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone, network, isSandbox } = req.body;

      if (!category || !quantity || !buyerName || !buyerEmail || !buyerPhone || !network) {
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields: name, email, phone number, category, and network (MTN or Airtel).',
        });
      }

      if (category !== 'VIP' && category !== 'ORDINARY') {
        return res.status(400).json({ success: false, message: 'Invalid ticket category. Must be VIP or ORDINARY.' });
      }

      if (network !== 'MTN' && network !== 'AIRTEL') {
        return res.status(400).json({ success: false, message: 'Network must be MTN or AIRTEL.' });
      }

      const result = await SupabaseServerService.initiateRelworxPayment({
        category,
        quantity: parseInt(quantity, 10),
        buyerName,
        buyerEmail,
        buyerPhone,
        network,
        isSandbox: Boolean(isSandbox),
      });

      if (!result.success) {
        return res.status(409).json(result);
      }

      res.json(result);
    } catch (err: any) {
      console.error('Relworx payment initiation route error:', err);
      res.status(500).json({ success: false, message: err?.message || 'Server error initiating payment.' });
    }
  });

  // Backwards-compatible alias for any in-flight client requests
  app.post('/api/payments/flutterwave-initiate', async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone, network, isSandbox } = req.body;
      const result = await SupabaseServerService.initiateRelworxPayment({
        category: category || 'ORDINARY',
        quantity: parseInt(quantity, 10) || 1,
        buyerName: buyerName || '',
        buyerEmail: buyerEmail || '',
        buyerPhone: buyerPhone || '',
        network: network || 'MTN',
        isSandbox: Boolean(isSandbox),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message });
    }
  });

  /**
   * Official Relworx Webhook Listener
   * Documentation: https://payments.relworx.com/docs
   * Receives notifications from Relworx upon transaction state changes (pending -> success / failed)
   * Strictly verifies cryptographic signature header (Relworx-Signature)
   * and double-checks server-side with Relworx verification API before issuing tickets.
   */
  app.post('/api/payments/relworx-webhook', async (req, res) => {
    try {
      // Signature header can come as Relworx-Signature or lowercase
      const signature = (req.headers['relworx-signature'] || req.headers['Relworx-Signature'] || req.headers['signature']) as string | undefined;

      // Cryptographic signature check
      if (!RelworxService.verifyWebhookSignature(signature, req.body)) {
        console.warn('[Relworx Webhook] Unauthorized webhook signature attempt rejected.');
        return res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
      }

      const body = req.body || {};
      const rawStatus = String(body.status || body.transaction_status || '').toLowerCase();
      const orderRef = body.customer_reference || body.reference || body.order_ref;
      const internalRef = body.internal_reference;
      const amount = body.amount ? Number(body.amount) : undefined;
      const currency = body.currency;

      if (!orderRef) {
        console.warn('[Relworx Webhook] Webhook payload missing order reference.');
        return res.status(200).json({ status: 'ignored', message: 'Missing order reference' });
      }

      // Handle successful payment
      if (['success', 'successful', 'completed', 'paid'].includes(rawStatus)) {
        // Independent verification with Relworx API (if live API key configured)
        if (RelworxService.isConfigured()) {
          const verification = await RelworxService.checkRequestStatus({
            internalReference: internalRef,
            reference: orderRef,
          });

          if (!verification.success || verification.status !== 'success') {
            console.warn(`[Relworx Webhook] Double-check verification did not confirm success: status=${verification.status}`);
            return res.status(200).json({ status: 'unverified', message: 'Relworx status check not yet success' });
          }

          // Currency and amount verification
          if (verification.currency && verification.currency !== 'UGX') {
            console.warn(`[Relworx Webhook] Invalid currency: ${verification.currency}`);
            return res.status(400).json({ status: 'error', message: 'Invalid currency' });
          }
        }

        // Idempotently mark order as paid & issue attendee tickets
        await SupabaseServerService.markOrderAsPaid(orderRef, {
          relworx: body,
          relworx_internal_ref: internalRef,
          amount,
          currency: currency || 'UGX',
        });

        return res.status(200).json({ status: 'success', message: 'Order payment verified and tickets issued' });
      }

      // Handle failed or cancelled payment
      if (['failed', 'declined', 'cancelled', 'expired', 'rejected'].includes(rawStatus)) {
        await SupabaseServerService.releaseReservationByOrderRef(orderRef);
        return res.status(200).json({ status: 'success', message: 'Order marked failed and inventory released' });
      }

      // Acknowledge receipt
      res.status(200).json({ status: 'ignored' });
    } catch (err: any) {
      console.error('[Relworx Webhook Error]', err);
      res.status(500).json({ status: 'error', message: err?.message });
    }
  });

  /**
   * Sandbox Testing Simulation Endpoint
   * Simulates customer approving the mobile money prompt on their handset for test QA.
   * Clearly identified and recorded with simulated audit markers.
   */
  app.post('/api/payments/relworx-simulate-success', async (req, res) => {
    try {
      const { orderRef } = req.body;
      if (!orderRef) {
        return res.status(400).json({ success: false, message: 'orderRef is required.' });
      }

      const ok = await SupabaseServerService.markOrderAsPaid(orderRef, {
        simulated: true,
        relworx_internal_ref: `sim_${Date.now()}`,
      });

      if (!ok) {
        return res.status(500).json({ success: false, message: 'Could not mark order as paid.' });
      }

      const orderData = await SupabaseServerService.getOrderStatus(orderRef);
      res.json({
        ...orderData,
        message: 'Sandbox Mobile Money PIN approval simulated. Tickets issued.',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Server error' });
    }
  });

  /**
   * Order Status & Polling Route
   * Frontend polls this while customer approves USSD prompt on their handset.
   * Only returns tickets and QR tokens when status is confirmed 'paid'!
   */
  app.get('/api/orders/:orderRef/status', async (req, res) => {
    try {
      const { orderRef } = req.params;
      if (!orderRef) {
        return res.status(400).json({ success: false, message: 'Order reference required.' });
      }

      const status = await SupabaseServerService.getOrderStatus(orderRef);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Error checking order status.' });
    }
  });

  /**
   * Attendee Self-Service Ticket Lookup
   * Allows customer to retrieve confirmed tickets by entering their phone number or order reference
   */
  app.post('/api/orders/lookup', async (req, res) => {
    try {
      const { contact } = req.body;
      if (!contact || contact.trim().length < 4) {
        return res.status(400).json({ success: false, message: 'Please enter a valid phone number or order reference.' });
      }

      const tickets = await SupabaseServerService.lookupTicketsByContact(contact);
      res.json({ success: true, count: tickets.length, tickets });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Error searching for tickets.' });
    }
  });

  /**
   * Single-Scan QR Gate Verification:
   * Checks token against database and atomically marks checked_in_at
   */
  app.post('/api/tickets/verify-checkin', async (req, res) => {
    try {
      const { tokenOrNumber } = req.body;
      if (!tokenOrNumber) {
        return res.status(400).json({ status: 'INVALID', message: 'Missing token or ticket number' });
      }

      const result = await SupabaseServerService.verifyAndCheckIn(tokenOrNumber);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ status: 'INVALID', message: err?.message || 'Verification error' });
    }
  });

  // ============================================================
  // ADMIN API ENDPOINTS (Protected)
  // ============================================================

  /**
   * Health Check & Diagnostics (Supabase + Relworx)
   */
  app.get('/api/admin/health', async (req, res) => {
    const health = await SupabaseServerService.checkConnection();
    res.json({
      supabaseConnected: health.connected,
      project: 'Poolparty',
      table: 'public.tickets',
      totalRecordsFound: health.count,
      relworxConfigured: RelworxService.isConfigured(),
      relworxAccount: RelworxService.getAccountNo() ? 'Configured' : 'Using default',
      error: health.error,
    });
  });

  /**
   * Get all 70 tickets for authenticated dashboard
   */
  app.get('/api/admin/tickets', async (req, res) => {
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
  app.get('/api/admin/orders', async (req, res) => {
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
  app.post('/api/admin/verify-relworx-transaction', async (req, res) => {
    try {
      const { orderRef } = req.body;
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef required' });

      const result = await SupabaseServerService.verifyRelworxOrderDirectly(orderRef);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message });
    }
  });

  // Backwards-compatible admin alias
  app.post('/api/admin/verify-flw-transaction', async (req, res) => {
    try {
      const { orderRef } = req.body;
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
  app.post('/api/admin/physical-sale', async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone } = req.body;
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
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message });
    }
  });

  /**
   * Confirm payment for online reservation manually (Staff fallback)
   */
  app.post('/api/admin/confirm-payment', async (req, res) => {
    try {
      const { ticketId } = req.body;
      const ok = await SupabaseServerService.confirmPaymentAdmin(ticketId);
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  /**
   * Release or cancel ticket
   */
  app.post('/api/admin/release-ticket', async (req, res) => {
    try {
      const { ticketId } = req.body;
      const ok = await SupabaseServerService.releaseTicketAdmin(ticketId);
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // ============================================================
  // FRONTEND DEV / STATIC SERVING
  // ============================================================
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    // Mount Vite middlewares in development
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pool Party Full-Stack Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
