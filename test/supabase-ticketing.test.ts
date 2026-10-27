import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createExpressApp } from '../src/server/app.js';
import { SupabaseServerService } from '../src/server/supabaseServer.js';
import { RelworxService, sanitizeDiagnosticText } from '../src/server/relworxService.js';
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

  it('10. Schema Mismatch / Stale PostgREST Cache Returns Actionable HTTP 503 Without Leaking Secrets', async () => {
    await startServer();

    const schemaErrMock = mock.method(SupabaseServerService, 'initiateRelworxPayment', async () => ({
      success: false,
      message:
        'Database schema update or cache reload required on public.tickets (missing order_ref, reserved_until, or relworx_internal_ref, or PostgREST schema cache not refreshed).',
      error: 'SCHEMA_MISMATCH',
    }));

    try {
      const res = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 1,
          buyerName: 'Schema Test Guest',
          buyerEmail: 'schema@example.ug',
          buyerPhone: '0775198484',
          network: 'MTN',
        }),
      });

      assert.strictEqual(res.status, 503, 'SCHEMA_MISMATCH must return HTTP 503');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'SCHEMA_MISMATCH');
      assert.ok(body.message.includes('order_ref'));
    } finally {
      schemaErrMock.mock.restore();
      await stopServer();
    }
  });

  it('11. RelworxService Explicitly Detects API_DISABLED & Enforces Cooldown Without Repeated Provider Calls', async () => {
    const prevKey = process.env.RELWORX_API_KEY;
    const prevAcct = process.env.RELWORX_ACCOUNT_NO;
    process.env.RELWORX_API_KEY = 'test_relworx_key_123456';
    process.env.RELWORX_ACCOUNT_NO = 'RELWORX_MERCHANT_99';
    RelworxService.resetProviderStateForTests();

    const originalFetch = globalThis.fetch;
    let relworxFetchCount = 0;

    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      if (url.startsWith('https://payments.relworx.com/')) {
        relworxFetchCount++;
        return new Response(
          JSON.stringify({
            success: false,
            error_code: 'API_DISABLED',
            message: 'Mobile Money API access is disabled for this merchant account.',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const firstAttempt = await RelworxService.requestPayment({
        reference: 'PP-RWX-1700000000001-1111',
        phone: '0775198484',
        amount: 20000,
        description: 'Pool Party 2026 - 1x ORDINARY Pass',
        category: 'ORDINARY',
        buyerName: 'Joel Mukisa',
      });

      assert.strictEqual(firstAttempt.success, false);
      assert.strictEqual(firstAttempt.error, 'PAYMENT_PROVIDER_UNAVAILABLE');
      assert.strictEqual(firstAttempt.code, 'API_DISABLED');
      assert.strictEqual(firstAttempt.retryable, true);
      assert.ok((firstAttempt.retryAfterSeconds ?? 0) > 0);
      assert.strictEqual(
        firstAttempt.message.includes('merchant account'),
        false,
        'Customer message must be safe and not leak internal merchant account details'
      );
      assert.strictEqual(relworxFetchCount, 1);

      // Immediate second call during cooldown must NOT call Relworx API again
      const secondAttempt = await RelworxService.requestPayment({
        reference: 'PP-RWX-1700000000002-2222',
        phone: '0775198484',
        amount: 20000,
        description: 'Pool Party 2026 - 1x ORDINARY Pass',
        category: 'ORDINARY',
        buyerName: 'Joel Mukisa',
      });

      assert.strictEqual(secondAttempt.success, false);
      assert.strictEqual(secondAttempt.code, 'API_DISABLED');
      assert.strictEqual(relworxFetchCount, 1, 'Must NOT repeatedly call disabled Relworx API during cooldown');
    } finally {
      globalThis.fetch = originalFetch;
      RelworxService.resetProviderStateForTests();
      if (prevKey === undefined) delete process.env.RELWORX_API_KEY;
      else process.env.RELWORX_API_KEY = prevKey;
      if (prevAcct === undefined) delete process.env.RELWORX_ACCOUNT_NO;
      else process.env.RELWORX_ACCOUNT_NO = prevAcct;
    }
  });

  it('12. /api/payments/relworx-initiate Returns HTTP 503 on API_DISABLED, Releases Reserved Tickets Immediately, and Skips Reservation During Cooldown', async () => {
    await startServer();

    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      RELWORX_API_KEY: process.env.RELWORX_API_KEY,
      RELWORX_ACCOUNT_NO: process.env.RELWORX_ACCOUNT_NO,
    };

    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    process.env.RELWORX_API_KEY = 'test_relworx_key_123456';
    process.env.RELWORX_ACCOUNT_NO = 'RELWORX_MERCHANT_99';
    RelworxService.resetProviderStateForTests();
    SupabaseServerService.resetDeduplicationStateForTests();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/')) {
        return new Response(
          JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.reserve_tickets_atomic' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.startsWith('https://poolpartytest.supabase.co/')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const expiredMock = mock.method(SupabaseServerService, 'releaseExpiredReservations', async () => 0);
    const reusableMock = mock.method(SupabaseServerService, 'findReusableActivePendingOrder', async () => null);
    const reserveDirectMock = mock.method(SupabaseServerService, 'reserveTicketsDirect', async () => ({
      success: true,
      message: 'Tickets reserved.',
    }));
    const releaseOrderMock = mock.method(
      SupabaseServerService,
      'releaseReservationByOrderRef',
      async (_orderRef: string, _status?: 'cancelled' | 'failed') => true
    );
    const requestPaymentMock = mock.method(RelworxService, 'requestPayment', async () => {
      const retryAfterSeconds = RelworxService.markProviderDisabled(30_000);
      return {
        success: false,
        message:
          'Mobile Money payments are temporarily unavailable right now. You have not been charged, and your selected passes remain available. Please try again later.',
        error: 'PAYMENT_PROVIDER_UNAVAILABLE',
        code: 'API_DISABLED',
        retryable: true,
        retryAfterSeconds,
      };
    });

    try {
      const res1 = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 2,
          buyerName: 'Joel Mukisa',
          buyerEmail: 'joel@example.ug',
          buyerPhone: '0775 198 484',
          network: 'MTN',
          idempotencyKey: 'idem-key-attempt-11111',
        }),
      });

      assert.strictEqual(res1.status, 503, 'Must return HTTP 503 (not HTTP 502) when provider API_DISABLED');
      assert.ok(res1.headers.get('retry-after'), 'Must set Retry-After header');
      const body1 = await res1.json();
      assert.strictEqual(body1.success, false);
      assert.strictEqual(body1.error, 'PAYMENT_PROVIDER_UNAVAILABLE');
      assert.strictEqual(body1.code, 'API_DISABLED');
      assert.strictEqual(body1.orderRef, undefined, 'Must not return active orderRef on failed initiation');
      assert.strictEqual(body1.tickets, undefined, 'Must NEVER issue tickets on failed initiation');

      assert.strictEqual(reserveDirectMock.mock.callCount(), 1);
      assert.strictEqual(requestPaymentMock.mock.callCount(), 1);
      assert.strictEqual(
        releaseOrderMock.mock.callCount(),
        1,
        'Must immediately release reserved tickets when Relworx initiation fails'
      );
      assert.strictEqual(
        releaseOrderMock.mock.calls[0].arguments[1],
        'failed',
        'Failed initiation must mark pending order as failed'
      );

      // Immediate second request during cooldown must NOT lock tickets or call Relworx again
      const res2 = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 2,
          buyerName: 'Joel Mukisa',
          buyerEmail: 'joel@example.ug',
          buyerPhone: '0775 198 484',
          network: 'MTN',
          idempotencyKey: 'idem-key-attempt-22222',
        }),
      });

      assert.strictEqual(res2.status, 503);
      const body2 = await res2.json();
      assert.strictEqual(body2.code, 'API_DISABLED');
      assert.strictEqual(
        reserveDirectMock.mock.callCount(),
        1,
        'Must NOT lock tickets in Supabase while provider API_DISABLED cooldown is active'
      );
      assert.strictEqual(
        requestPaymentMock.mock.callCount(),
        1,
        'Must NOT repeatedly call Relworx during API_DISABLED cooldown'
      );
    } finally {
      globalThis.fetch = originalFetch;
      expiredMock.mock.restore();
      reusableMock.mock.restore();
      reserveDirectMock.mock.restore();
      releaseOrderMock.mock.restore();
      requestPaymentMock.mock.restore();
      RelworxService.resetProviderStateForTests();
      SupabaseServerService.resetDeduplicationStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('13. Idempotency & Duplicate Submission Protection Prevents Duplicate Orders and Duplicate Charges', async () => {
    await startServer();

    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      RELWORX_API_KEY: process.env.RELWORX_API_KEY,
      RELWORX_ACCOUNT_NO: process.env.RELWORX_ACCOUNT_NO,
    };

    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    process.env.RELWORX_API_KEY = 'test_relworx_key_123456';
    process.env.RELWORX_ACCOUNT_NO = 'RELWORX_MERCHANT_99';
    RelworxService.resetProviderStateForTests();
    SupabaseServerService.resetDeduplicationStateForTests();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/')) {
        return new Response(
          JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.reserve_tickets_atomic' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.startsWith('https://poolpartytest.supabase.co/')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const expiredMock = mock.method(SupabaseServerService, 'releaseExpiredReservations', async () => 0);
    const reusableMock = mock.method(SupabaseServerService, 'findReusableActivePendingOrder', async () => null);
    const reserveDirectMock = mock.method(SupabaseServerService, 'reserveTicketsDirect', async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { success: true, message: 'Tickets reserved.' };
    });
    const requestPaymentMock = mock.method(RelworxService, 'requestPayment', async () => ({
      success: true,
      message: 'Payment prompt initiated. Check your phone to enter PIN.',
      internal_reference: 'rwx_live_ref_001',
    }));

    try {
      const payload = {
        category: 'VIP',
        quantity: 1,
        buyerName: 'Grace Tumusiime',
        buyerEmail: 'grace@example.ug',
        buyerPhone: '0701234567',
        network: 'AIRTEL',
        idempotencyKey: 'idem-same-checkout-attempt-999',
      };

      // Concurrent duplicate clicks with the same idempotencyKey
      const [r1, r2] = await Promise.all([
        fetch(`${baseUrl}/api/payments/relworx-initiate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        fetch(`${baseUrl}/api/payments/relworx-initiate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      ]);

      const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
      assert.strictEqual(r1.status, 200);
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(b1.orderRef, b2.orderRef, 'Concurrent retries must coalesce to the exact same orderRef');
      assert.strictEqual(reserveDirectMock.mock.callCount(), 1, 'Must reserve inventory only once');
      assert.strictEqual(requestPaymentMock.mock.callCount(), 1, 'Must initiate Relworx charge only once');

      // Sequential retry with the same idempotencyKey (e.g. client network retry)
      const r3 = await fetch(`${baseUrl}/api/payments/relworx-initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const b3 = await r3.json();
      assert.strictEqual(b3.orderRef, b1.orderRef, 'Sequential retry with same idempotencyKey must reuse orderRef');
      assert.strictEqual(b3.reusedExistingOrder, true);
      assert.strictEqual(requestPaymentMock.mock.callCount(), 1, 'Must never double-charge on idempotent retry');
    } finally {
      globalThis.fetch = originalFetch;
      expiredMock.mock.restore();
      reusableMock.mock.restore();
      reserveDirectMock.mock.restore();
      requestPaymentMock.mock.restore();
      RelworxService.resetProviderStateForTests();
      SupabaseServerService.resetDeduplicationStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('14. Server Diagnostic Sanitizer Redacts Credentials, Account Numbers, Phones, and Emails', () => {
    const raw =
      'Error for Bearer sk_live_secret999 on account RELWORX_ACCT_778899 for +256 775 198 484 and joel@example.ug';
    const sanitized = sanitizeDiagnosticText(raw);

    assert.strictEqual(sanitized.includes('sk_live_secret999'), false, 'Must redact Bearer token');
    assert.strictEqual(sanitized.includes('RELWORX_ACCT_778899'), false, 'Must redact Relworx account number');
    assert.strictEqual(sanitized.includes('775 198 484'), false, 'Must redact buyer phone number');
    assert.strictEqual(sanitized.includes('joel@example.ug'), false, 'Must redact buyer email');
  });
});


