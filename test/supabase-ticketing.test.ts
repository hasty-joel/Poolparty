import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createExpressApp } from '../src/server/app.js';
import { SupabaseServerService } from '../src/server/supabaseServer.js';
import { RelworxService } from '../src/server/relworxService.js';
import { TicketService } from '../src/lib/ticketService.js';

describe('Pool Party Supabase Ticketing & Purchase Flow Tests', () => {
  const app = createExpressApp();
  let server: http.Server;
  let baseUrl: string;

  const startServer = (): Promise<void> => {
    return new Promise((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  };

  const stopServer = (): Promise<void> => {
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  };

  it('1. Verified Removal of All Mock Data & In-Memory Stores', () => {
    assert.strictEqual((SupabaseServerService as any).serverMemoryStore, undefined, 'serverMemoryStore must not exist');
    assert.strictEqual((SupabaseServerService as any).serverOrdersStore, undefined, 'serverOrdersStore must not exist');
    assert.strictEqual((SupabaseServerService as any).initFallbackInventory, undefined, 'initFallbackInventory must not exist');
  });

  it('2. Admin Endpoints Require Server-Side Authorization (HTTP 401 on Unauthorized)', async () => {
    await startServer();

    try {
      const resTickets = await fetch(`${baseUrl}/api/admin/tickets`);
      assert.strictEqual(resTickets.status, 401, 'Must return 401 Unauthorized without admin token');
      const dataTickets = await resTickets.json();
      assert.strictEqual(dataTickets.success, false);

      const resOrders = await fetch(`${baseUrl}/api/admin/orders`);
      assert.strictEqual(resOrders.status, 401, 'Must return 401 Unauthorized without admin token');

      const resBadToken = await fetch(`${baseUrl}/api/admin/tickets`, {
        headers: { Authorization: 'Bearer wrong-passcode' },
      });
      assert.strictEqual(resBadToken.status, 401, 'Must reject incorrect admin passcode');

      const resValidToken = await fetch(`${baseUrl}/api/admin/health`, {
        headers: { Authorization: 'Bearer prince2026' },
      });
      assert.strictEqual(resValidToken.status, 200, 'Must allow access with valid admin passcode');
      const health = await resValidToken.json();
      assert.strictEqual(typeof health.supabaseConnected, 'boolean');
    } finally {
      await stopServer();
    }
  });

  it('3. Public Inventory Endpoint Strictly Hides Sensitive Attendee Data', async () => {
    await startServer();

    try {
      const res = await fetch(`${baseUrl}/api/inventory/counts`);
      const body = await res.json();

      if (res.status === 200) {
        assert.strictEqual(body.success, true);
        assert.ok(body.counts);
        assert.strictEqual(typeof body.counts.VIP.available, 'number');
        assert.strictEqual(typeof body.counts.ORDINARY.available, 'number');
        assert.strictEqual(body.counts.VIP.priceUgx, 50000, 'VIP price must be 50,000 UGX');
        assert.strictEqual(body.counts.ORDINARY.priceUgx, 20000, 'Ordinary price must be 20,000 UGX');

        const rawText = JSON.stringify(body);
        assert.strictEqual(rawText.includes('qr_token'), false, 'Must never leak qr_token');
        assert.strictEqual(rawText.includes('buyer_name'), false, 'Must never leak buyer_name');
        assert.strictEqual(rawText.includes('buyer_phone'), false, 'Must never leak buyer_phone');
        assert.strictEqual(rawText.includes('buyer_email'), false, 'Must never leak buyer_email');
      } else {
        assert.strictEqual(res.status, 503, 'Must return 503 when database is not connected');
        assert.strictEqual(body.success, false);
        assert.ok(body.error, 'Must provide clear database error message');
      }
    } finally {
      await stopServer();
    }
  });

  it('4. Validation Failures: Rejects Invalid Quantities, Tiers, Networks, Emails, and Uganda Phone Numbers', async () => {
    await startServer();

    try {
      // Invalid quantity 0
      const resZero = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 0,
          buyerName: 'Test Buyer',
          buyerEmail: 'buyer@test.ug',
          buyerPhone: '+256771234567',
          network: 'MTN',
        }),
      });
      assert.strictEqual(resZero.status, 400, 'Must reject quantity 0');

      // Invalid category
      const resBadCat = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'SUPER_VIP',
          quantity: 1,
          buyerName: 'Test Buyer',
          buyerEmail: 'buyer@test.ug',
          buyerPhone: '+256771234567',
          network: 'MTN',
        }),
      });
      assert.strictEqual(resBadCat.status, 400, 'Must reject invalid category');

      // Invalid network
      const resBadNet = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'VIP',
          quantity: 1,
          buyerName: 'Test Buyer',
          buyerEmail: 'buyer@test.ug',
          buyerPhone: '+256771234567',
          network: 'VODAFONE',
        }),
      });
      assert.strictEqual(resBadNet.status, 400, 'Must reject unsupported payment network');

      // Invalid email
      const resBadEmail = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 1,
          buyerName: 'Test Buyer',
          buyerEmail: 'not-an-email',
          buyerPhone: '0775198484',
          network: 'MTN',
        }),
      });
      assert.strictEqual(resBadEmail.status, 400, 'Must reject malformed email');

      // Invalid short phone number
      const resBadPhone = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 1,
          buyerName: 'Test Buyer',
          buyerEmail: 'buyer@test.ug',
          buyerPhone: '077123',
          network: 'MTN',
        }),
      });
      assert.strictEqual(resBadPhone.status, 400, 'Must reject invalid Uganda phone number');
      const badPhoneBody = await resBadPhone.json();
      assert.strictEqual(badPhoneBody.success, false);
      assert.ok(badPhoneBody.message);
    } finally {
      await stopServer();
    }
  });

  it('5. Successful Pending Order Creation & Reservation Without Issuing Unpaid Tickets', async () => {
    await startServer();

    const initiateMock = mock.method(
      SupabaseServerService,
      'initiateRelworxPayment',
      async (params: Parameters<typeof SupabaseServerService.initiateRelworxPayment>[0]) => ({
        success: true,
        orderRef: 'PP-RWX-1700000000000-1234',
        message: 'Payment prompt initiated. Check your phone to enter PIN.',
        relworxInternalRef: 'rwx_int_abc123',
        reservedUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        totalAmountUgx: (params.category === 'VIP' ? 50000 : 20000) * params.quantity,
        gateway: 'relworx' as const,
      })
    );

    try {
      const res = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 2,
          buyerName: 'Joel Mukisa',
          buyerEmail: 'joel@example.ug',
          buyerPhone: '0775 198 484',
          network: 'MTN',
        }),
      });

      assert.strictEqual(res.status, 200, 'Valid initiation must return HTTP 200');
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.orderRef, 'PP-RWX-1700000000000-1234');
      assert.strictEqual(body.totalAmountUgx, 40000, 'Server must compute trusted total (2 x 20,000 UGX)');
      assert.strictEqual(body.tickets, undefined, 'Must NEVER issue tickets or QR tokens before payment confirmation');
      assert.strictEqual(initiateMock.mock.callCount(), 1);
    } finally {
      initiateMock.mock.restore();
      await stopServer();
    }
  });

  it('6. Reservation Failure: Returns HTTP 409 When Inventory Is Insufficient', async () => {
    await startServer();

    const soldOutMock = mock.method(SupabaseServerService, 'initiateRelworxPayment', async () => ({
      success: false,
      message: 'Insufficient tickets available. Only 1 VIP pass(es) currently remaining.',
      error: 'INSUFFICIENT_INVENTORY',
    }));

    try {
      const res = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'VIP',
          quantity: 3,
          buyerName: 'Grace Tumusiime',
          buyerEmail: 'grace@example.ug',
          buyerPhone: '+256701234567',
          network: 'AIRTEL',
        }),
      });

      assert.strictEqual(res.status, 409, 'Insufficient inventory must return HTTP 409 Conflict');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.ok(body.message.includes('Insufficient tickets available'));
    } finally {
      soldOutMock.mock.restore();
      await stopServer();
    }
  });

  it('7. API & Upstream Errors: Returns Clean JSON on Unconfigured Services, Gateway Errors, Serverless Stripped Paths, and 404s', async () => {
    await startServer();

    // Case A: Unconfigured database / gateway returns 503 JSON
    const configErrMock = mock.method(SupabaseServerService, 'initiateRelworxPayment', async () => ({
      success: false,
      message: 'Ticketing database is currently unavailable.',
      error: 'SUPABASE_NOT_CONFIGURED',
    }));

    try {
      const res503 = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 1,
          buyerName: 'Test Guest',
          buyerEmail: 'guest@example.ug',
          buyerPhone: '0775198484',
          network: 'MTN',
        }),
      });
      assert.strictEqual(res503.status, 503, 'Missing backend config must return HTTP 503');
      const body503 = await res503.json();
      assert.strictEqual(body503.success, false);
      assert.ok(body503.message);
    } finally {
      configErrMock.mock.restore();
    }

    // Case B: Upstream Relworx timeout/failure returns 502 JSON
    const gatewayErrMock = mock.method(SupabaseServerService, 'initiateRelworxPayment', async () => ({
      success: false,
      message: 'Mobile Money provider took too long to respond.',
      error: 'RELWORX_TIMEOUT',
    }));

    try {
      // Also verify serverless stripped path (`/payments/relworx-initiate` without `/api`) routes identically
      const res502 = await fetch(`${baseUrl}/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 1,
          buyerName: 'Test Guest',
          buyerEmail: 'guest@example.ug',
          buyerPhone: '0775198484',
          network: 'MTN',
        }),
      });
      assert.strictEqual(res502.status, 502, 'Gateway timeout/error must return HTTP 502');
      const body502 = await res502.json();
      assert.strictEqual(body502.success, false);

      // Case C: Unknown `/api/*` route returns JSON 404 (not HTML)
      const res404 = await fetch(`${baseUrl}/api/unknown-endpoint`);
      assert.strictEqual(res404.status, 404);
      const body404 = await res404.json();
      assert.strictEqual(body404.success, false);
      assert.strictEqual(body404.error, 'NOT_FOUND');
    } finally {
      gatewayErrMock.mock.restore();
      await stopServer();
    }
  });

  it('8. Frontend TicketService Safely Handles Non-JSON HTML Error Responses Without Throwing', async () => {
    const htmlErrorServer = http.createServer((_req, res) => {
      res.writeHead(504, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body>504 Gateway Timeout</body></html>');
    });

    await new Promise<void>((resolve) => htmlErrorServer.listen(0, resolve));
    const port = (htmlErrorServer.address() as any).port;
    const originalFetch = globalThis.fetch;

    // Route relative `/api/...` calls from TicketService to the simulated HTML 504 server
    globalThis.fetch = ((input: any, init?: RequestInit) => {
      const url = typeof input === 'string' && input.startsWith('/') ? `http://127.0.0.1:${port}${input}` : input;
      return originalFetch(url, init);
    }) as typeof fetch;

    try {
      const paymentRes = await TicketService.initiateRelworxPayment({
        category: 'ORDINARY',
        quantity: 1,
        buyerName: 'Test Buyer',
        buyerEmail: 'buyer@test.ug',
        buyerPhone: '0775198484',
        network: 'MTN',
      });
      assert.strictEqual(paymentRes.success, false);
      assert.strictEqual(
        paymentRes.message.includes('Unexpected token'),
        false,
        'Must never expose raw JSON.parse SyntaxError to customer'
      );
      assert.ok(paymentRes.message.length > 10);
    } finally {
      globalThis.fetch = originalFetch;
      await new Promise<void>((resolve) => htmlErrorServer.close(() => resolve()));
    }
  });

  it('9. Gate Scanner Rejects Empty or Unrecognized Tokens & Webhook Signature Verification', async () => {
    await startServer();

    try {
      const resEmpty = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenOrNumber: '' }),
      });
      assert.strictEqual(resEmpty.status, 400, 'Must reject empty token');

      const resInvalid = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenOrNumber: 'fake-token-12345' }),
      });
      const dataInvalid = await resInvalid.json();
      assert.strictEqual(dataInvalid.status, 'INVALID', 'Must flag fake token as INVALID');

      const resUnauthorized = await fetch(`${baseUrl}/api/payments/relworx-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'relworx-signature': 'invalid_hash_signature',
        },
        body: JSON.stringify({
          status: 'success',
          customer_reference: 'PP-RWX-TEST',
          amount: 20000,
        }),
      });

      if (RelworxService.getWebhookSecret()) {
        assert.strictEqual(resUnauthorized.status, 401, 'Must reject invalid webhook signature when secret is configured');
      }
    } finally {
      await stopServer();
    }
  });
});
