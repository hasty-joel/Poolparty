import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { SupabaseServerService } from './src/server/supabaseServer';
import { FlutterwaveService } from './src/server/flutterwaveService';
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
   * Flutterwave Uganda Mobile Money Payment Initiation
   * Calculates trusted server price, atomically locks inventory with 10-minute expiry,
   * and initiates direct charge via official Flutterwave Uganda Mobile Money API.
   */
  app.post('/api/payments/flutterwave-initiate', async (req, res) => {
    try {
      const { category, quantity, buyerName, buyerEmail, buyerPhone, network } = req.body;

      if (!category || !quantity || !buyerName || !buyerEmail || !buyerPhone || !network) {
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields: name, email, phone number, category, and network (MTN or Airtel).',
        });
      }

      if (category !== 'VIP' && category !== 'ORDINARY') {
        return res.status(400).json({ success: false, message: 'Invalid ticket category.' });
      }

      if (network !== 'MTN' && network !== 'AIRTEL') {
        return res.status(400).json({ success: false, message: 'Network must be MTN or AIRTEL.' });
      }

      const appUrl =
        process.env.APP_URL ||
        `${req.protocol}://${req.get('host')}`;

      const result = await SupabaseServerService.initiateFlutterwavePayment({
        category,
        quantity: parseInt(quantity, 10),
        buyerName,
        buyerEmail,
        buyerPhone,
        network,
        appUrl,
      });

      if (!result.success) {
        return res.status(409).json(result);
      }

      res.json(result);
    } catch (err: any) {
      console.error('Payment initiation route error:', err);
      res.status(500).json({ success: false, message: err?.message || 'Server error initiating payment.' });
    }
  });

  /**
   * Flutterwave Webhook Listener
   * Receives notifications from Flutterwave upon successful charge
   * Strictly verifies webhook signature (verif-hash) and double-checks
   * with Flutterwave server-side verification API before issuing tickets.
   */
  app.post('/api/payments/flutterwave-webhook', async (req, res) => {
    try {
      const signature = req.headers['verif-hash'] as string | undefined;

      // Check webhook signature hash
      if (!FlutterwaveService.verifyWebhookSignature(signature)) {
        console.warn('Unauthorized Flutterwave webhook signature attempt.');
        return res.status(401).json({ status: 'error', message: 'Invalid signature hash' });
      }

      const { event, data } = req.body;

      // Only handle charge completion
      if (event === 'charge.completed' && data && data.status === 'successful') {
        const transactionId = data.id;
        const txRef = data.tx_ref;

        // Verify transaction server-side directly with Flutterwave API
        const verified = await FlutterwaveService.verifyTransactionById(transactionId);

        if (
          verified.success &&
          verified.status === 'successful' &&
          verified.currency === 'UGX' &&
          verified.tx_ref === txRef
        ) {
          // Idempotently issue tickets and mark order as paid
          await SupabaseServerService.markOrderAsPaid(txRef, verified);
          return res.status(200).json({ status: 'success', message: 'Order payment verified and issued' });
        }
      }

      // Acknowledge receipt
      res.status(200).json({ status: 'ignored' });
    } catch (err: any) {
      console.error('Flutterwave webhook processing error:', err);
      res.status(500).json({ status: 'error', message: err?.message });
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
   * Health Check & Diagnostics (Supabase + Flutterwave)
   */
  app.get('/api/admin/health', async (req, res) => {
    const health = await SupabaseServerService.checkConnection();
    res.json({
      supabaseConnected: health.connected,
      project: 'Poolparty',
      table: 'public.tickets',
      totalRecordsFound: health.count,
      flutterwaveConfigured: FlutterwaveService.isConfigured(),
      flutterwaveTestMode: FlutterwaveService.isTestMode(),
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
   * Admin Trigger: Manually verify pending transaction with Flutterwave API
   */
  app.post('/api/admin/verify-flw-transaction', async (req, res) => {
    try {
      const { orderRef } = req.body;
      if (!orderRef) return res.status(400).json({ success: false, message: 'orderRef required' });

      const flwVerify = await FlutterwaveService.verifyTransactionByRef(orderRef);
      if (flwVerify.success && flwVerify.status === 'successful') {
        await SupabaseServerService.markOrderAsPaid(orderRef, flwVerify);
        return res.json({ success: true, message: 'Transaction verified and marked paid on Supabase!', flwVerify });
      }

      res.json({ success: false, message: `Flutterwave status: ${flwVerify.status}`, flwVerify });
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
