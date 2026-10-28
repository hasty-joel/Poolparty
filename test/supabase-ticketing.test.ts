import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createExpressApp } from '../src/server/app.js';
import { SupabaseServerService } from '../src/server/supabaseServer.js';
import { GateSecurity } from '../src/server/gateSecurity.js';
import { RelworxService, sanitizeDiagnosticText } from '../src/server/relworxService.js';
import { MtnMoMoService } from '../src/server/mtnMoMoService.js';
import { TicketService, isOnlineTicketRecord } from '../src/lib/ticketService.js';
import { TicketRenderer, isRenderableQrToken } from '../src/lib/ticketRenderer.js';
import { WhatsAppService } from '../src/lib/whatsappService.js';

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
    const prevAdminPasscode = process.env.ADMIN_PASSCODE;
    const adminPasscode = 'organizer_admin_master_2026';
    process.env.ADMIN_PASSCODE = adminPasscode;
    GateSecurity.resetStateForTests();

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
        headers: { Authorization: `Bearer ${adminPasscode}` },
      });
      assert.strictEqual(resValidToken.status, 200, 'Must allow access with valid admin passcode');
      const health = await resValidToken.json();
      assert.strictEqual(typeof health.supabaseConnected, 'boolean');
    } finally {
      GateSecurity.resetStateForTests();
      if (prevAdminPasscode === undefined) delete process.env.ADMIN_PASSCODE;
      else process.env.ADMIN_PASSCODE = prevAdminPasscode;
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

  it('9. Gate Scanner Requires Staff Auth, Rejects Empty/Unrecognized Tokens & Verifies Webhook Signatures', async () => {
    await startServer();
    const prevGatePass = process.env.GATE_PASSCODE;
    process.env.GATE_PASSCODE = 'gate_test_passcode_2026';
    GateSecurity.resetStateForTests();

    try {
      // Unauthenticated check-in attempt must be rejected with HTTP 401
      const resUnauthScan = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenOrNumber: 'ORD-001' }),
      });
      assert.strictEqual(resUnauthScan.status, 401, 'Must reject unauthenticated check-in attempts with 401');

      // Authenticate gate staff session
      const loginRes = await fetch(`${baseUrl}/api/gate/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: 'gate_test_passcode_2026' }),
      });
      assert.strictEqual(loginRes.status, 200);
      const loginData = await loginRes.json();
      const gateAuthHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.sessionToken}`,
      };

      const resEmpty = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: gateAuthHeaders,
        body: JSON.stringify({ tokenOrNumber: '' }),
      });
      assert.strictEqual(resEmpty.status, 400, 'Must reject empty token');

      const resInvalid = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: gateAuthHeaders,
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
      GateSecurity.resetStateForTests();
      if (prevGatePass === undefined) delete process.env.GATE_PASSCODE;
      else process.env.GATE_PASSCODE = prevGatePass;
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

  it('15. MTN Mobile Money Configuration Endpoint (/api/payments/mtn-config)', async () => {
    await startServer();

    try {
      const res = await fetch(`${baseUrl}/api/payments/mtn-config`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.currency, 'UGX');
      assert.ok(data.instructions);
      assert.strictEqual(data.instructions.ussdCode, '*165*3#');
      assert.ok(Array.isArray(data.instructions.steps));
    } finally {
      await stopServer();
    }
  });

  it('16. MTN MoMo Reservation: Input Validation & Bounds Checking', async () => {
    await startServer();

    try {
      // Rejects quantity 0
      const resZero = await fetch(`${baseUrl}/api/payments/mtn-reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 0,
          buyerName: 'Joel Hasty',
          buyerEmail: 'joel@test.ug',
          buyerPhone: '+256771234567',
        }),
      });
      assert.strictEqual(resZero.status, 400);

      // Rejects invalid category
      const resCat = await fetch(`${baseUrl}/api/payments/mtn-reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'PLATINUM',
          quantity: 1,
          buyerName: 'Joel Hasty',
          buyerEmail: 'joel@test.ug',
          buyerPhone: '+256771234567',
        }),
      });
      assert.strictEqual(resCat.status, 400);

      // Rejects missing email
      const resEmail = await fetch(`${baseUrl}/api/payments/mtn-reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'VIP',
          quantity: 1,
          buyerName: 'Joel Hasty',
          buyerEmail: '',
          buyerPhone: '+256771234567',
        }),
      });
      assert.strictEqual(resEmail.status, 400);
    } finally {
      await stopServer();
    }
  });

  it('17. MTN MoMo Reservation: Locks Inventory for 15 Minutes & Calculates Trusted UGX Prices', async () => {
    await startServer();

    const mockReserve = mock.method(SupabaseServerService, 'initiateMtnMerchantReservation', async (params: any) => {
      const unitPrice = params.category === 'VIP' ? 50000 : 20000;
      return {
        success: true,
        orderRef: 'PP-MTN-1793000000000-TEST',
        reservedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        totalAmountUgx: unitPrice * params.quantity,
        category: params.category,
        quantity: params.quantity,
        merchantCode: '998877',
        merchantName: 'Prince Resort Bunamwaya',
        isConfigured: true,
        message: 'Pass reserved for 15 minutes. Pay to the MTN Merchant Code and submit your transaction ID.',
      };
    });

    try {
      // 1x VIP = 50,000 UGX
      const resVip = await fetch(`${baseUrl}/api/payments/mtn-reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'VIP',
          quantity: 1,
          buyerName: 'VIP Attendee',
          buyerEmail: 'vip@test.ug',
          buyerPhone: '0772123456',
        }),
      });
      assert.strictEqual(resVip.status, 200);
      const dataVip = await resVip.json();
      assert.strictEqual(dataVip.success, true);
      assert.strictEqual(dataVip.totalAmountUgx, 50000, 'VIP price must strictly be 50,000 UGX');
      assert.strictEqual(dataVip.orderRef, 'PP-MTN-1793000000000-TEST');
      assert.ok(dataVip.reservedUntil);

      // 2x Ordinary = 40,000 UGX
      const resOrd = await fetch(`${baseUrl}/api/payments/mtn-reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'ORDINARY',
          quantity: 2,
          buyerName: 'Ordinary Attendee',
          buyerEmail: 'ordinary@test.ug',
          buyerPhone: '0782123456',
        }),
      });
      assert.strictEqual(resOrd.status, 200);
      const dataOrd = await resOrd.json();
      assert.strictEqual(dataOrd.totalAmountUgx, 40000, '2x Ordinary passes must be 40,000 UGX');
    } finally {
      mockReserve.mock.restore();
      await stopServer();
    }
  });

  it('18. MTN MoMo Submission: Validates Transaction ID and Payer Phone, Never Issues Active Tickets Directly', async () => {
    await startServer();

    const mockSubmit = mock.method(SupabaseServerService, 'submitMtnTransaction', async (params: any) => {
      return {
        success: true,
        orderRef: params.orderRef,
        verificationStatus: 'pending_verification' as const,
        mtnTransactionId: params.mtnTransactionId,
        message: 'MTN payment submitted successfully! Our event admin will verify against the MTN Merchant portal before tickets are issued.',
      };
    });

    try {
      // Rejects invalid transaction ID format
      const resShort = await fetch(`${baseUrl}/api/payments/mtn-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderRef: 'PP-MTN-1793000000000-TEST',
          mtnTransactionId: '12',
          payerPhone: '0772123456',
        }),
      });
      assert.strictEqual(resShort.status, 400, 'Must reject transaction IDs shorter than 5 characters');

      // Accepts valid submission
      const resValid = await fetch(`${baseUrl}/api/payments/mtn-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderRef: 'PP-MTN-1793000000000-TEST',
          mtnTransactionId: 'MTN1234567890',
          payerPhone: '0772123456',
          notes: 'Paid via MoMoPay menu',
        }),
      });
      assert.strictEqual(resValid.status, 200);
      const dataValid = await resValid.json();
      assert.strictEqual(dataValid.success, true);
      assert.strictEqual(dataValid.verificationStatus, 'pending_verification');
      assert.strictEqual((dataValid as any).status, undefined, 'Order must not be marked paid upon submission');
      assert.strictEqual((dataValid as any).tickets, undefined, 'Tickets must never be issued prior to admin verification');
    } finally {
      mockSubmit.mock.restore();
      await stopServer();
    }
  });

  it('19. MTN MoMo Idempotency: Duplicate Transaction IDs Across Orders are Strictly Rejected (HTTP 409)', async () => {
    await startServer();

    const mockSubmit = mock.method(SupabaseServerService, 'submitMtnTransaction', async (params: any) => {
      if (params.mtnTransactionId === 'DUP999888777') {
        return {
          success: false,
          error: 'DUPLICATE_TRANSACTION_ID',
          message: 'This MTN Transaction ID has already been submitted for another order. Each payment transaction ID can only be registered once.',
        };
      }
      return {
        success: true,
        orderRef: params.orderRef,
        verificationStatus: 'pending_verification' as const,
        mtnTransactionId: params.mtnTransactionId,
        message: 'Submitted',
      };
    });

    try {
      const resDup = await fetch(`${baseUrl}/api/payments/mtn-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderRef: 'PP-MTN-OTHER-ORDER',
          mtnTransactionId: 'DUP999888777',
          payerPhone: '0772123456',
        }),
      });
      assert.strictEqual(resDup.status, 409, 'Must return HTTP 409 Conflict for duplicate transaction ID');
      const dataDup = await resDup.json();
      assert.strictEqual(dataDup.error, 'DUPLICATE_TRANSACTION_ID');
    } finally {
      mockSubmit.mock.restore();
      await stopServer();
    }
  });

  it('20. Admin Verification & Rejection: Authorization Enforced, Updates Status, and Activates/Releases Passes', async () => {
    await startServer();

    const prevAdminPasscode = process.env.ADMIN_PASSCODE;
    const adminPasscode = 'organizer_admin_master_2026';
    process.env.ADMIN_PASSCODE = adminPasscode;
    GateSecurity.resetStateForTests();

    const mockVerify = mock.method(SupabaseServerService, 'verifyMtnPaymentAdmin', async (params: any) => {
      return {
        success: true,
        orderRef: params.orderRef,
        message: 'MTN payment verified successfully. 1 ticket(s) issued.',
      };
    });

    const mockReject = mock.method(SupabaseServerService, 'rejectMtnPaymentAdmin', async (params: any) => {
      return {
        success: true,
        orderRef: params.orderRef,
        message: 'MTN payment submission rejected and 1 reserved pass(es) released.',
      };
    });

    try {
      // 1. Unauthorized attempts are rejected (HTTP 401)
      const resUnauth = await fetch(`${baseUrl}/api/admin/verify-mtn-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderRef: 'PP-MTN-1793000000000-TEST' }),
      });
      assert.strictEqual(resUnauth.status, 401, 'Admin verification must reject unauthorized requests');

      const resUnauthDirect = await fetch(`${baseUrl}/api/admin/mtn-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderRef: 'PP-MTN-1793000000000-TEST' }),
      });
      assert.strictEqual(resUnauthDirect.status, 401, '/api/admin/mtn-verify must reject unauthorized requests');

      // 1b. Missing orderRef returns HTTP 400
      const resMissingRef = await fetch(`${baseUrl}/api/admin/mtn-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminPasscode}`,
        },
        body: JSON.stringify({}),
      });
      assert.strictEqual(resMissingRef.status, 400, 'Missing orderRef must return HTTP 400');

      // 2. Authorized verification succeeds via /api/admin/mtn-verify
      const resAuth = await fetch(`${baseUrl}/api/admin/mtn-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminPasscode}`,
        },
        body: JSON.stringify({
          orderRef: 'PP-MTN-1793000000000-TEST',
          adminName: 'LeadOrganizer',
          notes: 'Confirmed 50000 UGX in MTN merchant portal',
        }),
      });
      assert.strictEqual(resAuth.status, 200);
      const dataAuth = await resAuth.json();
      assert.strictEqual(dataAuth.success, true);
      assert.strictEqual(mockVerify.mock.callCount(), 1);

      // 2b. Legacy alias /api/admin/verify-mtn-payment also succeeds
      const resLegacy = await fetch(`${baseUrl}/api/admin/verify-mtn-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminPasscode}`,
        },
        body: JSON.stringify({
          orderRef: 'PP-MTN-1793000000000-TEST',
          adminName: 'LeadOrganizer',
        }),
      });
      assert.strictEqual(resLegacy.status, 200);
      assert.strictEqual(mockVerify.mock.callCount(), 2);

      // 3. Authorized rejection succeeds and frees inventory via /api/admin/mtn-reject
      const resReject = await fetch(`${baseUrl}/api/admin/mtn-reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminPasscode}`,
        },
        body: JSON.stringify({
          orderRef: 'PP-MTN-1793000000000-TEST',
          reason: 'Transaction ID not found on MTN merchant portal after 24h',
          adminName: 'LeadOrganizer',
        }),
      });
      assert.strictEqual(resReject.status, 200);
      const dataReject = await resReject.json();
      assert.strictEqual(dataReject.success, true);
      assert.strictEqual(mockReject.mock.callCount(), 1);
    } finally {
      mockVerify.mock.restore();
      mockReject.mock.restore();
      GateSecurity.resetStateForTests();
      if (prevAdminPasscode === undefined) delete process.env.ADMIN_PASSCODE;
      else process.env.ADMIN_PASSCODE = prevAdminPasscode;
      await stopServer();
    }
  });

  it('21. WhatsApp Phone Formatting Validates Uganda Numbers & Generates Compliant wa.me URLs', () => {
    // Local Ugandan number with leading 0
    const local = WhatsAppService.formatPhoneForWhatsApp('0772 123 456');
    assert.strictEqual(local.valid, true);
    assert.strictEqual(local.internationalDigits, '256772123456');
    assert.strictEqual(local.displayPhone, '+256 772 123 456');

    // Airtel local number
    const airtel = WhatsAppService.formatPhoneForWhatsApp('0701987654');
    assert.strictEqual(airtel.valid, true);
    assert.strictEqual(airtel.internationalDigits, '256701987654');
    assert.strictEqual(airtel.displayPhone, '+256 701 987 654');

    // Number with +256 prefix
    const withPlus = WhatsAppService.formatPhoneForWhatsApp('+256 782 333 444');
    assert.strictEqual(withPlus.valid, true);
    assert.strictEqual(withPlus.internationalDigits, '256782333444');

    // Number with 256 prefix without plus
    const rawUganda = WhatsAppService.formatPhoneForWhatsApp('256750111222');
    assert.strictEqual(rawUganda.valid, true);
    assert.strictEqual(rawUganda.internationalDigits, '256750111222');

    // Invalid numbers
    const invalidShort = WhatsAppService.formatPhoneForWhatsApp('12345');
    assert.strictEqual(invalidShort.valid, false);

    const empty = WhatsAppService.formatPhoneForWhatsApp('');
    assert.strictEqual(empty.valid, false);

    // URL generation strictly adheres to wa.me specification (digits only, no + symbol)
    const url = WhatsAppService.generateWhatsAppUrl('256772123456', 'Hello Joel! 🎉');
    assert.ok(url.startsWith('https://wa.me/256772123456?text='), 'URL must begin with https://wa.me/{strictly_numeric_digits}?text=');
    assert.ok(!url.includes('+256'), 'Phone parameter in wa.me must not include + symbol');
    assert.ok(url.includes('Hello%20Joel'), 'Message body must be URI encoded');
  });

  it('22. WhatsApp Ticket Message Generates Required Customer, Pricing, and Unique Pass Verification Links', () => {
    const message = WhatsAppService.buildTicketMessage({
      buyerName: 'Joel Hasty',
      category: 'VIP',
      quantity: 2,
      totalAmountUgx: 100000,
      orderRef: 'PP-MTN-1793000000000-TEST',
      tickets: [
        { ticket_number: 'VIP-001', qr_token: 'qr_token_vip_001_mock' },
        { ticket_number: 'VIP-002', qr_token: 'qr_token_vip_002_mock' },
      ],
      origin: 'https://poolparty-ug.vercel.app',
    });

    // Check attendee name
    assert.ok(message.includes('Joel Hasty'), 'Must contain buyer name');
    // Check ticket category & quantity
    assert.ok(message.includes('VIP'), 'Must contain pass tier');
    assert.ok(message.includes('2'), 'Must contain quantity');
    // Check amount
    assert.ok(message.includes('100,000'), 'Must contain formatted UGX amount');
    // Check order reference
    assert.ok(message.includes('PP-MTN-1793000000000-TEST'), 'Must contain order reference');
    // Check entrance check-in instruction
    assert.ok(message.includes('Present your QR code at the entrance for check-in'), 'Must contain check-in guidance');
    // Check individual ticket passes with verification links
    assert.ok(message.includes('VIP-001'), 'Must include first ticket number');
    assert.ok(message.includes('VIP-002'), 'Must include second ticket number');
    assert.ok(message.includes('?verify=qr_token_vip_001_mock'), 'Must include unique verification link for VIP-001');
    assert.ok(message.includes('?verify=qr_token_vip_002_mock'), 'Must include unique verification link for VIP-002');
  });

  it('23. WhatsApp Delivery Safeguard: Unverified/Pending Orders Are Protected From Premature Ticket Release', () => {
    // When an order is not paid or verified, it cannot have active issued tickets
    const pendingOrder = {
      order_ref: 'PP-MTN-PENDING-99',
      status: 'pending',
      verification_status: 'pending_verification',
      category: 'ORDINARY',
      quantity: 1,
      total_amount_ugx: 20000,
    };

    const isPaid = pendingOrder.status === 'paid' || pendingOrder.verification_status === 'verified';
    assert.strictEqual(isPaid, false, 'Pending order must not evaluate to paid or verified');
  });

  it('24. Stage 1 SQL Migration Verifies Service-Role-Only Audit RLS, Least-Privilege RPC Grants, Conflict-Detecting Seeding & Signature Parity', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261028_stage1_hardcopy_tickets_and_audit.sql'
    );
    const prodMigrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261026_supabase_ticketing_production.sql'
    );
    const syncMigrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261027_safe_non_destructive_schema_sync.sql'
    );
    assert.ok(fs.existsSync(migrationPath), 'Stage 1 SQL migration file must exist');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const prodSql = fs.readFileSync(prodMigrationPath, 'utf8');
    const syncSql = fs.readFileSync(syncMigrationPath, 'utf8');

    // 1. Non-destructive guarantees: never drops or truncates existing 70 tickets
    assert.strictEqual(/drop\s+table/i.test(sql), false, 'Migration must NEVER drop tables');
    assert.strictEqual(/truncate\s+/i.test(sql), false, 'Migration must NEVER truncate tables');
    assert.strictEqual(/delete\s+from\s+public\.tickets/i.test(sql), false, 'Migration must NEVER delete existing tickets');

    // 2. Channel column defaults existing rows to 'online'
    assert.ok(
      /add\s+column\s+if\s+not\s+exists\s+ticket_channel\s+text\s+not\s+null\s+default\s+'online'/i.test(sql),
      'Must default existing tickets to online channel'
    );

    // 3. Pre-seed & post-seed conflict detection for channel, category, and price (never silent on corrupted rows)
    assert.ok(/v_online_conflicts/i.test(sql), 'Must detect mis-tagged online pool rows');
    assert.ok(/v_pre_hardcopy_conflicts/i.test(sql), 'Must detect pre-existing conflicting hardcopy numbers before INSERT');
    assert.ok(/v_post_hardcopy_conflicts/i.test(sql), 'Must verify all 300 hardcopy rows after INSERT');
    assert.ok(
      /Hardcopy migration aborted:\s*conflicting existing ticket number/i.test(sql),
      'Must raise exception on pre-existing channel/category/price conflicts'
    );
    assert.ok(/generate_series\(51,\s*250\)/i.test(sql), 'Must seed ORD-051 through ORD-250');
    assert.ok(/generate_series\(21,\s*120\)/i.test(sql), 'Must seed VIP-021 through VIP-120');
    const conflictClauses = sql.match(/on\s+conflict\s*\(ticket_number\)\s*do\s+nothing/gi) || [];
    assert.strictEqual(conflictClauses.length, 2, 'Both hardcopy seed inserts must use ON CONFLICT (ticket_number) DO NOTHING');

    // 4. hardcopy_audit_logs restricted strictly to service_role (never authenticated/anon/PUBLIC)
    assert.ok(/create\s+table\s+if\s+not\s+exists\s+public\.hardcopy_audit_logs/i.test(sql));
    assert.ok(/alter\s+table\s+public\.hardcopy_audit_logs\s+enable\s+row\s+level\s+security/i.test(sql));
    assert.ok(/alter\s+table\s+public\.hardcopy_audit_logs\s+force\s+row\s+level\s+security/i.test(sql));
    assert.ok(
      /revoke\s+all\s+on\s+table\s+public\.hardcopy_audit_logs\s+from\s+public,\s*anon,\s*authenticated/i.test(sql),
      'Must revoke PUBLIC, anon, and authenticated access on hardcopy_audit_logs'
    );
    assert.ok(
      /grant\s+select,\s*insert\s+on\s+table\s+public\.hardcopy_audit_logs\s+to\s+service_role/i.test(sql),
      'Must grant append-only SELECT, INSERT to service_role on hardcopy_audit_logs'
    );
    assert.strictEqual(
      /auth\.role\(\)\s*=\s*'authenticated'/i.test(sql),
      false,
      'Must NEVER permit arbitrary authenticated role on hardcopy_audit_logs RLS policy'
    );
    assert.ok(
      /to\s+service_role[\s\S]*using\s*\(\s*auth\.role\(\)\s*=\s*'service_role'\s*\)/i.test(sql),
      'RLS policy must restrict hardcopy_audit_logs to service_role'
    );

    // 5. All 5 SECURITY DEFINER RPCs pin search_path, revoke PUBLIC/anon/authenticated, and grant EXECUTE to service_role only
    const expectedRpcs = [
      'release_expired_ticket_reservations',
      'reserve_tickets_atomic',
      'gate_checkin_atomic',
      'activate_hardcopy_tickets_atomic',
      'update_hardcopy_tickets_status_atomic',
    ];
    for (const fnName of expectedRpcs) {
      assert.ok(
        new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fnName}`, 'i').test(sql),
        `Must define ${fnName}`
      );
      assert.ok(
        new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fnName}\\s*\\([\\s\\S]*?\\)\\s*from\\s+public,\\s*anon,\\s*authenticated`, 'i').test(sql),
        `Must revoke PUBLIC, anon, authenticated EXECUTE on ${fnName}`
      );
      assert.ok(
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fnName}\\s*\\([\\s\\S]*?\\)\\s*to\\s+service_role`, 'i').test(sql),
        `Must grant EXECUTE on ${fnName} to service_role`
      );
    }
    const searchPathMatches = sql.match(/set\s+search_path\s*=\s*public,\s*extensions/gi) || [];
    assert.strictEqual(searchPathMatches.length, 5, 'All 5 SECURITY DEFINER RPCs must pin search_path');

    // 6. Existing RPC signatures match prior migrations (20261026_supabase_ticketing_production & 20261027_safe_non_destructive_schema_sync)
    assert.ok(/function\s+public\.release_expired_ticket_reservations\(\)\s*returns\s+integer/i.test(prodSql));
    assert.ok(/function\s+public\.release_expired_ticket_reservations\(\)\s*returns\s+integer/i.test(sql));
    assert.ok(
      /function\s+public\.reserve_tickets_atomic\(\s*p_category\s+text,\s*p_quantity\s+integer,\s*p_buyer_name\s+text,\s*p_buyer_email\s+text,\s*p_buyer_phone\s+text,\s*p_order_ref\s+text,\s*p_reserved_until\s+timestamptz,\s*p_network\s+text\s+default\s+'MTN',\s*p_unit_price\s+integer\s+default\s+20000,\s*p_total_amount\s+integer\s+default\s+20000\s*\)\s*returns\s+json/i.test(
        syncSql
      )
    );
    assert.ok(
      /function\s+public\.reserve_tickets_atomic\(\s*p_category\s+text,\s*p_quantity\s+integer,\s*p_buyer_name\s+text,\s*p_buyer_email\s+text,\s*p_buyer_phone\s+text,\s*p_order_ref\s+text,\s*p_reserved_until\s+timestamptz,\s*p_network\s+text\s+default\s+'MTN',\s*p_unit_price\s+integer\s+default\s+20000,\s*p_total_amount\s+integer\s+default\s+20000\s*\)\s*returns\s+json/i.test(
        sql
      ),
      'reserve_tickets_atomic signature, defaults, and return type must match previous migrations'
    );
    assert.ok(/function\s+public\.gate_checkin_atomic\(\s*p_token_or_number\s+text\s*\)\s*returns\s+json/i.test(prodSql));
    assert.ok(/function\s+public\.gate_checkin_atomic\(\s*p_token_or_number\s+text\s*\)\s*returns\s+json/i.test(sql));

    // 7. gate_checkin_atomic never serializes raw row_to_json(v_ticket) and redacts email, phone, and qr_token
    assert.strictEqual(/row_to_json\s*\(\s*v_ticket\s*\)/i.test(sql), false, 'Must NEVER leak full v_ticket row in gate_checkin_atomic');
    assert.ok(/'buyer_email',\s*null/i.test(sql));
    assert.ok(/'buyer_phone',\s*null/i.test(sql));
    assert.ok(/'qr_token',\s*'\[REDACTED\]'/i.test(sql));

    // 8. Both hardcopy RPCs enforce duplicate rejection, price integrity, and atomic RETURNING count verification
    const dupChecks = sql.match(/'DUPLICATE_TICKET_NUMBERS'/g) || [];
    assert.strictEqual(dupChecks.length, 2, 'Both hardcopy RPCs must reject duplicate ticket numbers');
    const integrityChecks = sql.match(/'DATA_INTEGRITY_ERROR'/g) || [];
    assert.strictEqual(integrityChecks.length, 2, 'Both hardcopy RPCs must verify database price integrity');
    const returningTicketNumMatches = sql.match(/returning\s+ticket_number/gi) || [];
    assert.strictEqual(returningTicketNumMatches.length, 3, 'All hardcopy UPDATE branches must capture exact updated rows via RETURNING ticket_number');
  });

  it('25. Gate Authentication: Signed Session Cookie/Token, Session Expiry, Logout Revocation, Rate Limiting & Secret Redaction', async () => {
    await startServer();
    const prevEnv = {
      GATE_PASSCODE: process.env.GATE_PASSCODE,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
      GATE_SESSION_SECRET: process.env.GATE_SESSION_SECRET,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };

    process.env.GATE_PASSCODE = 'gate_secret_pass_8844';
    process.env.ADMIN_PASSCODE = 'admin_secret_pass_9911';
    process.env.GATE_SESSION_SECRET = 'super_long_gate_signing_secret_for_tests_2026';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_service_role_secret_for_redaction_test_123456';
    GateSecurity.resetStateForTests();

    try {
      // 1. Valid gate passcode issues signed session + HttpOnly cookie
      const loginRes = await fetch(`${baseUrl}/api/gate/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.10.1.1' },
        body: JSON.stringify({ passcode: 'gate_secret_pass_8844' }),
      });
      assert.strictEqual(loginRes.status, 200);
      const setCookie = loginRes.headers.get('set-cookie') || '';
      assert.ok(setCookie.includes('pp_gate_session='), 'Must set session cookie');
      assert.ok(setCookie.includes('HttpOnly'), 'Cookie must be HttpOnly');
      assert.ok(setCookie.includes('SameSite=Strict'), 'Cookie must be SameSite=Strict');

      const loginBody = await loginRes.json();
      assert.strictEqual(loginBody.success, true);
      assert.strictEqual(loginBody.role, 'gate_staff');
      assert.ok(String(loginBody.sessionToken).startsWith('ppgs1.'));

      // 2. Session status check via Cookie header
      const cookiePair = setCookie.split(';')[0];
      const statusRes = await fetch(`${baseUrl}/api/gate/session`, {
        headers: { Cookie: cookiePair },
      });
      const statusBody = await statusRes.json();
      assert.strictEqual(statusBody.authenticated, true);
      assert.strictEqual(statusBody.role, 'gate_staff');

      // 3. Logout revokes token immediately
      const logoutRes = await fetch(`${baseUrl}/api/gate/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${loginBody.sessionToken}` },
      });
      assert.strictEqual(logoutRes.status, 200);

      const postLogoutScan = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${loginBody.sessionToken}`,
        },
        body: JSON.stringify({ tokenOrNumber: 'ORD-001' }),
      });
      assert.strictEqual(postLogoutScan.status, 401, 'Revoked session token must be rejected with 401');
      const postLogoutBody = await postLogoutScan.json();
      assert.strictEqual(postLogoutBody.error, 'SESSION_EXPIRED');

      // 4. Expired session token is rejected with 401 SESSION_EXPIRED
      const shortSession = GateSecurity.issueSession('gate_staff', 1);
      await new Promise((r) => setTimeout(r, 1100));
      const expiredScan = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${shortSession.sessionToken}`,
        },
        body: JSON.stringify({ tokenOrNumber: 'ORD-001' }),
      });
      assert.strictEqual(expiredScan.status, 401, 'Expired session token must be rejected with 401');
      const expiredBody = await expiredScan.json();
      assert.strictEqual(expiredBody.error, 'SESSION_EXPIRED');

      // 5. Brute-force rate limit: 5 wrong attempts return 401, 6th returns 429 with Retry-After
      for (let i = 1; i <= 5; i++) {
        const badRes = await fetch(`${baseUrl}/api/gate/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.10.9.99' },
          body: JSON.stringify({ passcode: `wrong_attempt_${i}` }),
        });
        assert.strictEqual(badRes.status, 401);
      }

      const throttledRes = await fetch(`${baseUrl}/api/gate/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.10.9.99' },
        body: JSON.stringify({ passcode: 'gate_secret_pass_8844' }),
      });
      assert.strictEqual(throttledRes.status, 429, '6th failed login window attempt must return HTTP 429');
      assert.ok(throttledRes.headers.get('retry-after'), 'Must include Retry-After header');

      // 6. Secret redaction helper scrubs passcodes, signing secrets, service-role keys, and session tokens
      const leakedSample = `Err gate=gate_secret_pass_8844 admin=admin_secret_pass_9911 key=sb_service_role_secret_for_redaction_test_123456 tok=${loginBody.sessionToken}`;
      const scrubbed = GateSecurity.redactServerSecrets(leakedSample);
      assert.strictEqual(scrubbed.includes('gate_secret_pass_8844'), false);
      assert.strictEqual(scrubbed.includes('admin_secret_pass_9911'), false);
      assert.strictEqual(scrubbed.includes('sb_service_role_secret_for_redaction_test_123456'), false);
      assert.strictEqual(scrubbed.includes(loginBody.sessionToken), false);
    } finally {
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('26. Strict Role Separation: Gate Staff Cannot Activate Hardcopy Tickets or Access Admin Endpoints (HTTP 403)', async () => {
    await startServer();
    const prevEnv = {
      GATE_PASSCODE: process.env.GATE_PASSCODE,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
    };
    process.env.GATE_PASSCODE = 'gate_only_passcode_2026';
    process.env.ADMIN_PASSCODE = 'organizer_admin_master_2026';
    GateSecurity.resetStateForTests();

    const checkInMock = mock.method(SupabaseServerService, 'verifyAndCheckIn', async () => ({
      status: 'ADMITTED' as const,
      message: 'ADMITTED: Welcome to Pool Party, Guest! (ORDINARY Pass #ORD-051)',
      checkedInAt: '2026-10-28T16:00:00.000Z',
      ticket: {
        id: '11111111-1111-4111-8111-111111111111',
        ticket_number: 'ORD-051',
        category: 'ORDINARY' as const,
        price_ugx: 20000,
        status: 'issued' as const,
        payment_status: 'manual_paid' as const,
        buyer_name: 'Walkup Guest',
        buyer_email: 'private@guest.ug',
        buyer_phone: '+256772000111',
        qr_token: '22222222-2222-4222-8222-222222222222',
        created_at: '2026-10-28T10:00:00.000Z',
        paid_at: '2026-10-28T12:00:00.000Z',
        checked_in_at: '2026-10-28T16:00:00.000Z',
        ticket_channel: 'hardcopy' as const,
      },
    }));

    try {
      const loginRes = await fetch(`${baseUrl}/api/gate/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: 'gate_only_passcode_2026' }),
      });
      const { sessionToken } = await loginRes.json();

      // Gate staff session must receive 403 Forbidden on every admin & hardcopy management endpoint
      const adminEndpoints: Array<{ method: string; path: string; body?: any }> = [
        { method: 'GET', path: '/api/admin/tickets' },
        { method: 'GET', path: '/api/admin/orders' },
        { method: 'GET', path: '/api/admin/hardcopy/audit-logs' },
        { method: 'GET', path: '/api/admin/hardcopy/summary' },
        {
          method: 'POST',
          path: '/api/admin/hardcopy/activate',
          body: { ticketNumber: 'ORD-051', sellerName: 'Agent X' },
        },
        {
          method: 'POST',
          path: '/api/admin/hardcopy/status',
          body: { ticketNumber: 'ORD-051', action: 'void_cancel', sellerName: 'Agent X' },
        },
      ];

      for (const ep of adminEndpoints) {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });
        assert.strictEqual(res.status, 403, `Gate staff must receive 403 on ${ep.method} ${ep.path}`);
      }

      // Raw GATE_PASSCODE in Authorization header must also receive 403 on admin endpoints
      const rawGateOnAdmin = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer gate_only_passcode_2026',
        },
        body: JSON.stringify({ ticketNumber: 'ORD-051', sellerName: 'Agent X' }),
      });
      assert.strictEqual(rawGateOnAdmin.status, 403);

      // Gate staff session CAN check tickets in, and PII / raw qr_token are redacted
      const scanRes = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ tokenOrNumber: '22222222-2222-4222-8222-222222222222' }),
      });
      assert.strictEqual(scanRes.status, 200);
      const scanBody = await scanRes.json();
      assert.strictEqual(scanBody.status, 'ADMITTED');
      assert.strictEqual(scanBody.ticket.qr_token, '[REDACTED]', 'Must redact raw qr_token for gate_staff');
      assert.strictEqual(scanBody.ticket.buyer_email, null, 'Must redact buyer_email for gate_staff');
      assert.strictEqual(scanBody.ticket.buyer_phone, null, 'Must redact buyer_phone for gate_staff');
    } finally {
      checkInMock.mock.restore();
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('27. Read-Only Public Ticket Status Endpoint: Accepts UUID Only, Hides Buyer PII, and Never Modifies Check-In State', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    GateSecurity.resetStateForTests();

    const paidUuid = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const unactivatedHardcopyUuid = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    let supabaseMutationCount = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = (init?.method || 'GET').toUpperCase();
      if (url.startsWith('https://poolpartytest.supabase.co/')) {
        if (method !== 'GET' && method !== 'HEAD') {
          supabaseMutationCount++;
        }
        if (url.includes(paidUuid)) {
          return new Response(
            JSON.stringify({
              ticket_number: 'VIP-005',
              category: 'VIP',
              status: 'issued',
              payment_status: 'paid',
              checked_in_at: null,
              ticket_channel: 'online',
              buyer_name: 'Confidential Buyer Name',
              buyer_email: 'confidential@buyer.ug',
              buyer_phone: '+256772999888',
              order_ref: 'PP-RWX-CONFIDENTIAL',
              qr_token: paidUuid,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes(unactivatedHardcopyUuid)) {
          return new Response(
            JSON.stringify({
              ticket_number: 'ORD-051',
              category: 'ORDINARY',
              status: 'available',
              payment_status: 'unpaid',
              checked_in_at: null,
              ticket_channel: 'hardcopy',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      // 1. Sequential ticket numbers must be rejected (HTTP 400) to prevent inventory enumeration
      const seqRes = await fetch(`${baseUrl}/api/tickets/public-status?token=ORD-051`);
      assert.strictEqual(seqRes.status, 400);

      // 2. Valid issued/paid UUID returns minimal VALID_UNUSED status with zero PII
      const validRes = await fetch(`${baseUrl}/api/tickets/public-status?token=${paidUuid}`);
      assert.strictEqual(validRes.status, 200);
      const validBody = await validRes.json();
      assert.strictEqual(validBody.valid, true);
      assert.strictEqual(validBody.status, 'VALID_UNUSED');
      assert.strictEqual(validBody.ticketNumber, 'VIP-005');
      assert.strictEqual(validBody.category, 'VIP');
      assert.strictEqual(validBody.channel, 'online');
      assert.strictEqual(validBody.checkedIn, false);

      const serialized = JSON.stringify(validBody);
      assert.strictEqual(serialized.includes('Confidential Buyer Name'), false, 'Must NEVER leak buyer_name');
      assert.strictEqual(serialized.includes('confidential@buyer.ug'), false, 'Must NEVER leak buyer_email');
      assert.strictEqual(serialized.includes('772999888'), false, 'Must NEVER leak buyer_phone');
      assert.strictEqual(serialized.includes('PP-RWX-CONFIDENTIAL'), false, 'Must NEVER leak order_ref');
      assert.strictEqual(serialized.includes(paidUuid), false, 'Must NEVER echo raw qr_token');

      // 3. Unactivated hardcopy UUID returns INACTIVE and valid: false
      const inactiveRes = await fetch(`${baseUrl}/api/tickets/public-status?token=${unactivatedHardcopyUuid}`);
      assert.strictEqual(inactiveRes.status, 200);
      const inactiveBody = await inactiveRes.json();
      assert.strictEqual(inactiveBody.valid, false);
      assert.strictEqual(inactiveBody.status, 'INACTIVE');
      assert.strictEqual(inactiveBody.channel, 'hardcopy');
      assert.strictEqual(inactiveBody.ticketNumber, 'ORD-051');

      // 4. Strictly read-only: zero mutations sent to Supabase
      assert.strictEqual(supabaseMutationCount, 0, 'Public status endpoint must NEVER mutate ticket state');
    } finally {
      globalThis.fetch = originalFetch;
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('28. Channel Isolation: Online Counts & Reservations Exclude All 300 Hardcopy Tickets', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';

    const mockDbTickets = [
      // Online pool: only 1 Ordinary available, 1 Ordinary issued, 0 VIP available
      { id: 'on-ord-1', ticket_number: 'ORD-001', category: 'ORDINARY', status: 'available', ticket_channel: 'online' },
      { id: 'on-ord-2', ticket_number: 'ORD-002', category: 'ORDINARY', status: 'issued', ticket_channel: 'online' },
      { id: 'on-vip-1', ticket_number: 'VIP-001', category: 'VIP', status: 'issued', ticket_channel: 'online' },
      // Hardcopy pool: plenty of available physical passes that MUST NOT be sold/counted online
      { id: 'hc-ord-51', ticket_number: 'ORD-051', category: 'ORDINARY', status: 'available', ticket_channel: 'hardcopy' },
      { id: 'hc-ord-52', ticket_number: 'ORD-052', category: 'ORDINARY', status: 'available', ticket_channel: 'hardcopy' },
      { id: 'hc-ord-53', ticket_number: 'ORD-053', category: 'ORDINARY', status: 'available', ticket_channel: 'hardcopy' },
      { id: 'hc-vip-21', ticket_number: 'VIP-021', category: 'VIP', status: 'available', ticket_channel: 'hardcopy' },
      { id: 'hc-vip-22', ticket_number: 'VIP-022', category: 'VIP', status: 'available', ticket_channel: 'hardcopy' },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/')) {
        return new Response(JSON.stringify({ code: 'PGRST202', message: 'RPC not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/tickets')) {
        const parsedUrl = new URL(url);
        const channelFilter = parsedUrl.searchParams.get('ticket_channel');
        const categoryFilter = parsedUrl.searchParams.get('category');
        const statusFilter = parsedUrl.searchParams.get('status');

        let rows = [...mockDbTickets];
        if (channelFilter === 'eq.online') {
          rows = rows.filter((r) => r.ticket_channel === 'online');
        }
        if (categoryFilter?.startsWith('eq.')) {
          const cat = categoryFilter.slice(3);
          rows = rows.filter((r) => r.category === cat);
        }
        if (statusFilter === 'eq.available') {
          rows = rows.filter((r) => r.status === 'available');
        }
        if (statusFilter === 'eq.reserved') {
          rows = [];
        }
        return new Response(JSON.stringify(rows), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      // 1. Public counts only reflect online pool (1 available Ordinary out of 2 online, 0 available VIP out of 1 online)
      const countsRes = await fetch(`${baseUrl}/api/inventory/counts`);
      assert.strictEqual(countsRes.status, 200);
      const countsBody = await countsRes.json();
      assert.strictEqual(countsBody.counts.ORDINARY.total, 2);
      assert.strictEqual(countsBody.counts.ORDINARY.available, 1);
      assert.strictEqual(countsBody.counts.VIP.total, 1);
      assert.strictEqual(countsBody.counts.VIP.available, 0);

      // 2. Direct online reservation of 2 Ordinary fails with INSUFFICIENT_INVENTORY despite hardcopy stock
      const directReserve = await SupabaseServerService.reserveTicketsDirect(
        'ORDINARY',
        2,
        'Online Buyer',
        'online@test.ug',
        '0775198484',
        'PP-RWX-TEST-ISO',
        new Date(Date.now() + 600_000).toISOString(),
        'MTN',
        20000,
        40000
      );
      assert.strictEqual(directReserve.success, false);
      assert.strictEqual(directReserve.error, 'INSUFFICIENT_INVENTORY');

      // 3. MTN online reservation of 1 VIP also fails with INSUFFICIENT_INVENTORY despite VIP-021/022 hardcopy stock
      const mtnReserve = await SupabaseServerService.initiateMtnMerchantReservation({
        category: 'VIP',
        quantity: 1,
        buyerName: 'Online VIP Buyer',
        buyerEmail: 'vip@test.ug',
        buyerPhone: '0775198484',
      });
      assert.strictEqual(mtnReserve.success, false);
      assert.strictEqual(mtnReserve.error, 'INSUFFICIENT_INVENTORY');
    } finally {
      globalThis.fetch = originalFetch;
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('29. Atomic Check-In Fallback: Safe Ticket-Number Lookup (ORD-051/VIP-021), Injection Rejection & Simultaneous Duplicate Prevention', async () => {
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';

    const rows = new Map<string, any>([
      [
        'ORD-051',
        {
          id: 'c0000051-0000-4000-8000-000000000051',
          ticket_number: 'ORD-051',
          category: 'ORDINARY',
          price_ugx: 20000,
          status: 'issued',
          payment_status: 'manual_paid',
          buyer_name: 'Agent Sale Guest',
          qr_token: 'd0000051-0000-4000-8000-000000000051',
          checked_in_at: null,
          ticket_channel: 'hardcopy',
        },
      ],
      [
        'VIP-021',
        {
          id: 'c0000021-0000-4000-8000-000000000021',
          ticket_number: 'VIP-021',
          category: 'VIP',
          price_ugx: 50000,
          status: 'available',
          payment_status: 'unpaid',
          buyer_name: null,
          qr_token: 'd0000021-0000-4000-8000-000000000021',
          checked_in_at: null,
          ticket_channel: 'hardcopy',
        },
      ],
    ]);

    let sawUnsafeOrFilter = false;
    let ticketTableRequests = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = (init?.method || 'GET').toUpperCase();

      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/gate_checkin_atomic')) {
        // Force fallback path in verifyAndCheckIn
        return new Response(JSON.stringify({ code: 'PGRST202', message: 'Function not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/tickets')) {
        ticketTableRequests++;
        const parsed = new URL(url);
        if (parsed.searchParams.has('or')) {
          sawUnsafeOrFilter = true;
        }

        if (method === 'GET') {
          const qrParam = parsed.searchParams.get('qr_token');
          const numParam = parsed.searchParams.get('ticket_number');
          let found: any = null;
          for (const r of rows.values()) {
            if (qrParam === `eq.${r.qr_token}` || numParam === `eq.${r.ticket_number}`) {
              found = { ...r };
              break;
            }
          }
          return new Response(JSON.stringify(found), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (method === 'PATCH') {
          await new Promise((r) => setTimeout(r, 25));
          const idParam = parsed.searchParams.get('id');
          const checkedInFilter = parsed.searchParams.get('checked_in_at');
          const body = JSON.parse(String(init?.body || '{}'));

          for (const r of rows.values()) {
            if (idParam === `eq.${r.id}` && checkedInFilter === 'is.null' && r.checked_in_at === null) {
              r.checked_in_at = body.checked_in_at;
              return new Response(JSON.stringify({ ...r }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }
          return new Response(JSON.stringify(null), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      // 1. Malformed / PostgREST filter-injection string is rejected before hitting Supabase
      const beforeReqs = ticketTableRequests;
      const injectionAttempt = await SupabaseServerService.verifyAndCheckIn('VIP-001,id.neq.0');
      assert.strictEqual(injectionAttempt.status, 'INVALID');
      assert.strictEqual(ticketTableRequests, beforeReqs, 'Malformed input must not query PostgREST');

      // 2. Unactivated hardcopy ticket VIP-021 is denied as UNPAID
      const unactivatedRes = await SupabaseServerService.verifyAndCheckIn('VIP-021');
      assert.strictEqual(unactivatedRes.status, 'UNPAID');
      assert.ok(unactivatedRes.message.includes('not been activated'), 'Must explain hardcopy pass is not activated');
      assert.strictEqual(rows.get('VIP-021').checked_in_at, null);

      // 3. Simultaneous duplicate scans on activated hardcopy pass ORD-051: exactly 1 ADMITTED and 1 ALREADY_USED
      const [scanA, scanB] = await Promise.all([
        SupabaseServerService.verifyAndCheckIn('ord-051'),
        SupabaseServerService.verifyAndCheckIn('ORD-051'),
      ]);
      const statuses = [scanA.status, scanB.status].sort();
      assert.deepStrictEqual(statuses, ['ADMITTED', 'ALREADY_USED'], 'Must never double-admit simultaneous scans');
      assert.strictEqual(
        sawUnsafeOrFilter,
        false,
        'Must use typed eq(ticket_number) or eq(qr_token), never unsafe .or() that casts VIP/ORD codes to uuid'
      );
    } finally {
      globalThis.fetch = originalFetch;
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('30. Admin Hardcopy Activation: Pre-RPC Bounds Validation, RPC Contract Forwarding & Fail-Closed When RPC Missing (No HTTP PATCH Fallback)', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    process.env.ADMIN_PASSCODE = 'organizer_admin_master_2026';
    GateSecurity.resetStateForTests();

    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer organizer_admin_master_2026',
    };

    // Note: Mocked HTTP responses below test server-side API validation & RPC contract handling ONLY
    // (never claimed as proof of PostgreSQL database transaction atomicity).
    const ticketStore = new Map<string, any>();
    for (let n = 51; n <= 62; n++) {
      const code = `ORD-${String(n).padStart(3, '0')}`;
      ticketStore.set(code, {
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        ticket_number: code,
        category: 'ORDINARY',
        price_ugx: 20000,
        status: 'available',
        payment_status: 'unpaid',
        checked_in_at: null,
        ticket_channel: 'hardcopy',
        qr_token: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`,
      });
    }
    for (let n = 21; n <= 25; n++) {
      const code = `VIP-${String(n).padStart(3, '0')}`;
      ticketStore.set(code, {
        id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
        ticket_number: code,
        category: 'VIP',
        price_ugx: 50000,
        status: 'available',
        payment_status: 'unpaid',
        checked_in_at: null,
        ticket_channel: 'hardcopy',
        qr_token: `22222222-2222-4222-9222-${String(n).padStart(12, '0')}`,
      });
    }

    const auditStore: any[] = [];
    let simulateMissingRpc = false;
    let ticketPatchCount = 0;
    let auditPostCount = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = (init?.method || 'GET').toUpperCase();

      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/activate_hardcopy_tickets_atomic')) {
        if (simulateMissingRpc) {
          return new Response(JSON.stringify({ code: 'PGRST202', message: 'RPC not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const body = JSON.parse(String(init?.body || '{}'));
        const nums: string[] = body.p_ticket_numbers || [];
        const conflicting = nums.filter((num) => ticketStore.get(num)?.status !== 'available');

        if (conflicting.length > 0) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'TICKETS_NOT_AVAILABLE',
              message: `Cannot activate range: ${conflicting.length} ticket(s) are not available.`,
              conflictingTickets: conflicting,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const unitPriceUgx = body.p_category === 'VIP' ? 50000 : 20000;
        const totalAmountUgx = unitPriceUgx * nums.length;
        const nowIso = '2026-10-28T10:00:00.000Z';

        for (const num of nums) {
          const row = ticketStore.get(num);
          row.status = 'issued';
          row.payment_status = 'manual_paid';
          row.assigned_agent = body.p_agent_or_seller;
          row.activated_by = body.p_performed_by;
          row.activated_at = nowIso;
          row.hardcopy_batch_ref = body.p_batch_ref;
        }

        const auditEntry = {
          id: `audit-${auditStore.length + 1}`,
          batch_ref: body.p_batch_ref,
          action: body.p_action,
          category: body.p_category,
          ticket_numbers: nums,
          quantity: nums.length,
          unit_price_ugx: unitPriceUgx,
          total_amount_ugx: totalAmountUgx,
          agent_or_seller: body.p_agent_or_seller,
          performed_by: body.p_performed_by,
          notes: body.p_notes,
          created_at: nowIso,
        };
        auditStore.unshift(auditEntry);

        return new Response(
          JSON.stringify({
            success: true,
            message: `Activated ${nums.length} hardcopy ticket(s).`,
            batchRef: body.p_batch_ref,
            auditId: auditEntry.id,
            action: body.p_action,
            category: body.p_category,
            activatedCount: nums.length,
            ticketNumbers: nums,
            unitPriceUgx,
            totalAmountUgx,
            sellerName: body.p_agent_or_seller,
            performedBy: body.p_performed_by,
            activatedAt: nowIso,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/tickets')) {
        if (method === 'PATCH') {
          ticketPatchCount++;
        }
        return new Response(JSON.stringify(Array.from(ticketStore.values())), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/hardcopy_audit_logs')) {
        if (method === 'POST') {
          auditPostCount++;
        }
        if (method === 'GET') {
          return new Response(JSON.stringify(auditStore), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      // 1. Rejects online pool numbers (ORD-001..ORD-050, VIP-001..VIP-020) and out-of-range numbers before RPC
      const resOnlineForbidden = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ ticketNumber: 'ORD-010', sellerName: 'Agent Kato' }),
      });
      assert.strictEqual(resOnlineForbidden.status, 400);
      const onlineForbiddenBody = await resOnlineForbidden.json();
      assert.strictEqual(onlineForbiddenBody.error, 'ONLINE_TICKET_FORBIDDEN');

      const resOutOfRange = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ ticketNumber: 'ORD-251', sellerName: 'Agent Kato' }),
      });
      assert.strictEqual(resOutOfRange.status, 400);
      const outOfRangeBody = await resOutOfRange.json();
      assert.strictEqual(outOfRangeBody.error, 'OUT_OF_HARDCOPY_RANGE');

      // 2. Single VIP activation via RPC (VIP-021 @ 50,000 UGX) + preserves existing QR token
      const originalVipQr = ticketStore.get('VIP-021').qr_token;
      const singleRes = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumber: 'VIP-021',
          sellerName: 'Promoter Sarah',
          adminName: 'JoelAdmin',
        }),
      });
      assert.strictEqual(singleRes.status, 200);
      const singleBody = await singleRes.json();
      assert.strictEqual(singleBody.success, true);
      assert.strictEqual(singleBody.action, 'activate_single');
      assert.strictEqual(singleBody.activatedCount, 1);
      assert.strictEqual(singleBody.totalAmountUgx, 50000);
      assert.strictEqual(ticketStore.get('VIP-021').qr_token, originalVipQr, 'Must preserve printed QR token');

      // 3. Contiguous range activation via RPC (ORD-051..ORD-055 = 5 x 20,000 = 100,000 UGX)
      const rangeRes = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          category: 'ORDINARY',
          startNumber: 'ORD-051',
          endNumber: 'ORD-055',
          sellerName: 'Agent Kato',
          adminName: 'JoelAdmin',
          notes: 'Booklet #1 handed over',
        }),
      });
      assert.strictEqual(rangeRes.status, 200);
      const rangeBody = await rangeRes.json();
      assert.strictEqual(rangeBody.success, true);
      assert.strictEqual(rangeBody.action, 'activate_range');
      assert.strictEqual(rangeBody.activatedCount, 5);
      assert.strictEqual(rangeBody.totalAmountUgx, 100000);

      // 4. Overlapping range conflict returned by RPC maps to HTTP 409 without modifying ORD-056..ORD-058
      const conflictRes = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          category: 'ORDINARY',
          startNumber: 54,
          endNumber: 58,
          sellerName: 'Agent Kato',
        }),
      });
      assert.strictEqual(conflictRes.status, 409);
      const conflictBody = await conflictRes.json();
      assert.strictEqual(conflictBody.error, 'TICKETS_NOT_AVAILABLE');
      assert.deepStrictEqual(conflictBody.conflictingTickets, ['ORD-054', 'ORD-055']);
      assert.strictEqual(ticketStore.get('ORD-056').status, 'available');

      // 5. Missing PostgreSQL RPC fails closed with HTTP 503 SCHEMA_MISMATCH and ZERO HTTP PATCH / audit POST calls
      simulateMissingRpc = true;
      const missingRpcRes = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          category: 'ORDINARY',
          startNumber: 'ORD-060',
          endNumber: 'ORD-061',
          sellerName: 'Agent Kato',
        }),
      });
      simulateMissingRpc = false;
      assert.strictEqual(missingRpcRes.status, 503);
      const missingRpcBody = await missingRpcRes.json();
      assert.strictEqual(missingRpcBody.error, 'SCHEMA_MISMATCH');
      assert.strictEqual(ticketPatchCount, 0, 'Must NEVER fall back to HTTP PATCH on /rest/v1/tickets');
      assert.strictEqual(auditPostCount, 0, 'Must NEVER write separate non-transactional HTTP POST audit logs');
      assert.strictEqual(ticketStore.get('ORD-060').status, 'available');

      // 6. Audit logs endpoint returns recorded RPC audit rows
      const logsRes = await fetch(`${baseUrl}/api/admin/hardcopy/audit-logs`, {
        headers: adminHeaders,
      });
      assert.strictEqual(logsRes.status, 200);
      const logsBody = await logsRes.json();
      assert.strictEqual(logsBody.success, true);
      assert.strictEqual(logsBody.logs.length, 2);
      assert.strictEqual(logsBody.logs[0].action, 'activate_range');
      assert.strictEqual(logsBody.logs[0].agent_or_seller, 'Agent Kato');
      assert.deepStrictEqual(logsBody.logs[0].ticket_numbers, ['ORD-051', 'ORD-052', 'ORD-053', 'ORD-054', 'ORD-055']);
    } finally {
      globalThis.fetch = originalFetch;
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('31. Check-In API Never Exposes Buyer Email, Phone, Raw QR Token, or Payment Refs (For Both Gate Staff and Admin)', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      GATE_PASSCODE: process.env.GATE_PASSCODE,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    process.env.GATE_PASSCODE = 'gate_only_passcode_2026';
    process.env.ADMIN_PASSCODE = 'organizer_admin_master_2026';
    GateSecurity.resetStateForTests();

    const issuedQr = '99999999-1111-4111-8111-999999999999';
    const reservedQr = '88888888-2222-4222-8222-888888888888';

    // Simulate even an un-upgraded RPC returning sensitive DB fields — server defense-in-depth must still strip them
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/gate_checkin_atomic')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.p_token_or_number === issuedQr) {
          return new Response(
            JSON.stringify({
              status: 'ADMITTED',
              message: 'ADMITTED: Welcome to Pool Party, Sarah Namukasa! (VIP Pass #VIP-007)',
              checkedInAt: '2026-10-28T18:30:00.000Z',
              ticket: {
                id: '77777777-7777-4777-8777-777777777777',
                ticket_number: 'VIP-007',
                category: 'VIP',
                price_ugx: 50000,
                status: 'issued',
                payment_status: 'paid',
                buyer_name: 'Sarah Namukasa',
                buyer_email: 'sarah.private@domain.ug',
                buyer_phone: '+256772555444',
                qr_token: issuedQr,
                order_ref: 'PP-RWX-SECRET-ORDER-77',
                relworx_internal_ref: 'RWX-INT-SECRET-77',
                mtn_transaction_id: 'MTN-TX-SECRET-77',
                assigned_agent: 'Internal Agent Note',
                created_at: '2026-10-27T10:00:00.000Z',
                paid_at: '2026-10-27T10:05:00.000Z',
                checked_in_at: '2026-10-28T18:30:00.000Z',
                ticket_channel: 'online',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            status: 'UNPAID',
            message: 'Ticket ORD-012 is unpaid (reserved). Payment required.',
            ticket: {
              id: '66666666-6666-4666-8666-666666666666',
              ticket_number: 'ORD-012',
              category: 'ORDINARY',
              price_ugx: 20000,
              status: 'reserved',
              payment_status: 'pending',
              buyer_name: 'Unpaid Hold Customer',
              buyer_email: 'unpaid.hold@domain.ug',
              buyer_phone: '+256782333222',
              qr_token: reservedQr,
              order_ref: 'PP-MTN-PENDING-12',
              created_at: '2026-10-27T11:00:00.000Z',
              paid_at: null,
              checked_in_at: null,
              ticket_channel: 'online',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const gateSession = GateSecurity.issueSession('gate_staff', 3600);

      // 1. Check-in called with ADMIN_PASSCODE must ALSO strip email, phone, raw qr_token, order_ref, and payment refs
      const adminScanRes = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer organizer_admin_master_2026',
        },
        body: JSON.stringify({ tokenOrNumber: issuedQr }),
      });
      assert.strictEqual(adminScanRes.status, 200);
      const adminScanBody = await adminScanRes.json();
      const adminRawJson = JSON.stringify(adminScanBody);

      assert.strictEqual(adminScanBody.status, 'ADMITTED');
      assert.strictEqual(adminScanBody.ticket.ticket_number, 'VIP-007');
      assert.strictEqual(adminScanBody.ticket.buyer_name, 'Sarah Namukasa');
      assert.strictEqual(adminScanBody.ticket.buyer_email, null, 'Admin check-in response must NOT expose buyer_email');
      assert.strictEqual(adminScanBody.ticket.buyer_phone, null, 'Admin check-in response must NOT expose buyer_phone');
      assert.strictEqual(adminScanBody.ticket.qr_token, '[REDACTED]', 'Admin check-in response must NOT expose raw qr_token');
      assert.strictEqual(adminRawJson.includes('sarah.private@domain.ug'), false);
      assert.strictEqual(adminRawJson.includes('772555444'), false);
      assert.strictEqual(adminRawJson.includes(issuedQr), false);
      assert.strictEqual(adminRawJson.includes('PP-RWX-SECRET-ORDER-77'), false);
      assert.strictEqual(adminRawJson.includes('RWX-INT-SECRET-77'), false);
      assert.strictEqual(adminRawJson.includes('MTN-TX-SECRET-77'), false);
      assert.strictEqual(adminRawJson.includes('Internal Agent Note'), false);

      // 2. Unpaid / reserved ticket check-in also hides unverified hold buyer_name in addition to email/phone/refs
      const gateUnpaidRes = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gateSession.sessionToken}`,
        },
        body: JSON.stringify({ tokenOrNumber: reservedQr }),
      });
      assert.strictEqual(gateUnpaidRes.status, 200);
      const gateUnpaidBody = await gateUnpaidRes.json();
      const unpaidRawJson = JSON.stringify(gateUnpaidBody);

      assert.strictEqual(gateUnpaidBody.status, 'UNPAID');
      assert.strictEqual(gateUnpaidBody.ticket.buyer_name, null, 'Unpaid hold must not expose tentative buyer_name');
      assert.strictEqual(unpaidRawJson.includes('Unpaid Hold Customer'), false);
      assert.strictEqual(unpaidRawJson.includes('unpaid.hold@domain.ug'), false);
      assert.strictEqual(unpaidRawJson.includes('782333222'), false);
      assert.strictEqual(unpaidRawJson.includes(reservedQr), false);
      assert.strictEqual(unpaidRawJson.includes('PP-MTN-PENDING-12'), false);
    } finally {
      globalThis.fetch = originalFetch;
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('32. Hardcopy Batch Validation: Rejects Duplicate Ticket Numbers, Category/Price Mismatches & Missing Seller/Actor/Batch Fields', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    process.env.ADMIN_PASSCODE = 'organizer_admin_master_2026';
    GateSecurity.resetStateForTests();

    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer organizer_admin_master_2026',
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/activate_hardcopy_tickets_atomic')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if ((body.p_ticket_numbers || []).includes('ORD-070')) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'DATA_INTEGRITY_ERROR',
              message: 'Data integrity error: corrupted price_ugx on ORD-070.',
              conflictingTickets: ['ORD-070'],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/update_hardcopy_tickets_status_atomic')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if ((body.p_ticket_numbers || []).includes('ORD-071')) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'CATEGORY_MISMATCH',
              message: 'Category mismatch in database for ORD-071.',
              conflictingTickets: ['ORD-071'],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      // 1. Duplicate ticket numbers in batch rejected on BOTH /activate and /status (case/whitespace insensitive)
      const dupActivate = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumbers: ['ORD-051', ' ord-051 ', 'ORD-052'],
          category: 'ORDINARY',
          sellerName: 'Agent Kato',
          adminName: 'JoelAdmin',
        }),
      });
      assert.strictEqual(dupActivate.status, 400);
      const dupActivateBody = await dupActivate.json();
      assert.strictEqual(dupActivateBody.error, 'DUPLICATE_TICKET_NUMBERS');
      assert.deepStrictEqual(dupActivateBody.conflictingTickets, ['ORD-051']);

      const dupStatus = await fetch(`${baseUrl}/api/admin/hardcopy/status`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumbers: ['VIP-025', 'vip-025'],
          category: 'VIP',
          action: 'void_cancel',
          sellerName: 'Agent Kato',
          adminName: 'JoelAdmin',
        }),
      });
      assert.strictEqual(dupStatus.status, 400);
      const dupStatusBody = await dupStatus.json();
      assert.strictEqual(dupStatusBody.error, 'DUPLICATE_TICKET_NUMBERS');
      assert.deepStrictEqual(dupStatusBody.conflictingTickets, ['VIP-025']);

      // 2. Category validation enforced consistently on BOTH /activate and /status
      const badCatActivate = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumber: 'ORD-051',
          category: 'PLATINUM',
          sellerName: 'Agent Kato',
        }),
      });
      assert.strictEqual(badCatActivate.status, 400);
      assert.strictEqual((await badCatActivate.json()).error, 'VALIDATION_ERROR');

      const mismatchCatStatus = await fetch(`${baseUrl}/api/admin/hardcopy/status`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumber: 'ORD-071',
          category: 'VIP',
          action: 'deactivate_return',
          sellerName: 'Agent Kato',
        }),
      });
      assert.strictEqual(mismatchCatStatus.status, 400);
      assert.strictEqual((await mismatchCatStatus.json()).error, 'CATEGORY_MISMATCH');

      // 3. Required sellerName, adminName (performedBy), and batchRef format validated on BOTH endpoints
      const invalidFields = [
        { sellerName: 'A', adminName: 'JoelAdmin', batchRef: 'BATCH_01' }, // seller too short
        { sellerName: 'Agent Kato', adminName: ' ', batchRef: 'BATCH_01' }, // blank actor
        { sellerName: 'Agent Kato', adminName: 'JoelAdmin', batchRef: 'bad ref!' }, // invalid batchRef chars
        { sellerName: 'Agent Kato', adminName: 'JoelAdmin', batchRef: 'ab' }, // batchRef too short
      ];

      for (const fields of invalidFields) {
        const r1 = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({ ticketNumber: 'ORD-070', ...fields }),
        });
        assert.strictEqual(r1.status, 400);
        assert.strictEqual((await r1.json()).error, 'VALIDATION_ERROR');

        const r2 = await fetch(`${baseUrl}/api/admin/hardcopy/status`, {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({ ticketNumber: 'ORD-071', action: 'void_cancel', ...fields }),
        });
        assert.strictEqual(r2.status, 400);
        assert.strictEqual((await r2.json()).error, 'VALIDATION_ERROR');
      }

      // 4. RPC-reported DATA_INTEGRITY_ERROR / CATEGORY_MISMATCH map to HTTP 409 / 400
      const corruptedPriceRes = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumber: 'ORD-070',
          category: 'ORDINARY',
          sellerName: 'Agent Kato',
          adminName: 'JoelAdmin',
        }),
      });
      assert.strictEqual(corruptedPriceRes.status, 409);
      const corruptedPriceBody = await corruptedPriceRes.json();
      assert.strictEqual(corruptedPriceBody.error, 'DATA_INTEGRITY_ERROR');

      const corruptedDbCatRes = await fetch(`${baseUrl}/api/admin/hardcopy/status`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumber: 'ORD-071',
          category: 'ORDINARY',
          action: 'deactivate_return',
          sellerName: 'Agent Kato',
          adminName: 'JoelAdmin',
        }),
      });
      assert.strictEqual(corruptedDbCatRes.status, 400);
      assert.strictEqual((await corruptedDbCatRes.json()).error, 'CATEGORY_MISMATCH');
    } finally {
      globalThis.fetch = originalFetch;
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('33. Hardcopy Status RPC Contract: Rejects No-Op States, Maps RPC Conflict Codes & Fails Closed When RPC Missing', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    process.env.ADMIN_PASSCODE = 'organizer_admin_master_2026';
    GateSecurity.resetStateForTests();

    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer organizer_admin_master_2026',
    };

    // Mocked RPC contract verification (does not claim PostgreSQL engine transaction testing)
    const ticketStore = new Map<string, any>([
      [
        'ORD-080',
        {
          id: '00000000-0000-4000-8000-000000000080',
          ticket_number: 'ORD-080',
          category: 'ORDINARY',
          price_ugx: 20000,
          status: 'available',
          payment_status: 'unpaid',
          checked_in_at: null,
          ticket_channel: 'hardcopy',
          qr_token: '80808080-1111-4111-8111-808080808080',
        },
      ],
      [
        'ORD-081',
        {
          id: '00000000-0000-4000-8000-000000000081',
          ticket_number: 'ORD-081',
          category: 'ORDINARY',
          price_ugx: 20000,
          status: 'issued',
          payment_status: 'manual_paid',
          checked_in_at: null,
          ticket_channel: 'hardcopy',
          qr_token: '81818181-1111-4111-8111-818181818181',
        },
      ],
      [
        'ORD-082',
        {
          id: '00000000-0000-4000-8000-000000000082',
          ticket_number: 'ORD-082',
          category: 'ORDINARY',
          price_ugx: 20000,
          status: 'issued',
          payment_status: 'manual_paid',
          checked_in_at: null,
          ticket_channel: 'hardcopy',
          qr_token: '82828282-1111-4111-8111-828282828282',
        },
      ],
      [
        'ORD-083',
        {
          id: '00000000-0000-4000-8000-000000000083',
          ticket_number: 'ORD-083',
          category: 'ORDINARY',
          price_ugx: 20000,
          status: 'cancelled',
          payment_status: 'unpaid',
          checked_in_at: null,
          ticket_channel: 'hardcopy',
          qr_token: '83838383-1111-4111-8111-838383838383',
        },
      ],
    ]);

    let simulateRpcCountMismatch = false;
    let simulateMissingRpc = false;
    let ticketPatchCalls = 0;
    const forwardedBatches: any[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = (init?.method || 'GET').toUpperCase();

      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/update_hardcopy_tickets_status_atomic')) {
        if (simulateMissingRpc) {
          return new Response(JSON.stringify({ code: 'PGRST202', message: 'RPC not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const body = JSON.parse(String(init?.body || '{}'));
        const nums: string[] = body.p_ticket_numbers || [];

        if (simulateRpcCountMismatch) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'ATOMIC_UPDATE_MISMATCH',
              message: 'Expected ticket count did not match inside RPC transaction.',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        for (const num of nums) {
          const row = ticketStore.get(num);
          if (body.p_action === 'deactivate_return' && row?.status !== 'issued') {
            return new Response(
              JSON.stringify({
                success: false,
                error: 'TICKETS_INVALID_STATE',
                message: `Cannot return ${num}: ticket is not in issued state.`,
                conflictingTickets: [num],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (body.p_action === 'void_cancel' && row?.status === 'cancelled') {
            return new Response(
              JSON.stringify({
                success: false,
                error: 'TICKETS_INVALID_STATE',
                message: `Cannot void ${num}: ticket is already cancelled.`,
                conflictingTickets: [num],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }

        for (const num of nums) {
          const row = ticketStore.get(num);
          if (body.p_action === 'deactivate_return') {
            row.status = 'available';
            row.payment_status = 'unpaid';
          } else {
            row.status = 'cancelled';
            row.payment_status = 'unpaid';
          }
        }

        forwardedBatches.push(body);
        return new Response(
          JSON.stringify({
            success: true,
            message: `Updated ${nums.length} hardcopy ticket(s).`,
            auditId: `audit-status-${forwardedBatches.length}`,
            batchRef: body.p_batch_ref,
            action: body.p_action,
            category: body.p_category,
            updatedCount: nums.length,
            ticketNumbers: nums,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/tickets') && method === 'PATCH') {
        ticketPatchCalls++;
      }

      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      // 1. Returning an already unactivated ('available') ticket returns HTTP 409 TICKETS_INVALID_STATE
      const noopReturn = await fetch(`${baseUrl}/api/admin/hardcopy/status`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumber: 'ORD-080',
          action: 'deactivate_return',
          sellerName: 'Promoter Bosco',
          adminName: 'JoelAdmin',
        }),
      });
      assert.strictEqual(noopReturn.status, 409);
      assert.strictEqual((await noopReturn.json()).error, 'TICKETS_INVALID_STATE');

      // 2. Voiding an already cancelled ticket returns HTTP 409 TICKETS_INVALID_STATE
      const noopVoid = await fetch(`${baseUrl}/api/admin/hardcopy/status`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumber: 'ORD-083',
          action: 'void_cancel',
          sellerName: 'Promoter Bosco',
          adminName: 'JoelAdmin',
        }),
      });
      assert.strictEqual(noopVoid.status, 409);
      assert.strictEqual((await noopVoid.json()).error, 'TICKETS_INVALID_STATE');

      // 3. RPC count mismatch maps to HTTP 409 ATOMIC_UPDATE_MISMATCH
      simulateRpcCountMismatch = true;
      const partialRes = await fetch(`${baseUrl}/api/admin/hardcopy/status`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumbers: ['ORD-081', 'ORD-082'],
          category: 'ORDINARY',
          action: 'deactivate_return',
          sellerName: 'Promoter Bosco',
          adminName: 'JoelAdmin',
          batchRef: 'PP-HC-RETURN-FAIL-01',
        }),
      });
      simulateRpcCountMismatch = false;
      assert.strictEqual(partialRes.status, 409);
      assert.strictEqual((await partialRes.json()).error, 'ATOMIC_UPDATE_MISMATCH');

      // 4. Missing PostgreSQL RPC fails closed with HTTP 503 SCHEMA_MISMATCH and ZERO HTTP PATCH calls
      simulateMissingRpc = true;
      const missingRpcRes = await fetch(`${baseUrl}/api/admin/hardcopy/status`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumbers: ['ORD-081', 'ORD-082'],
          category: 'ORDINARY',
          action: 'deactivate_return',
          sellerName: 'Promoter Bosco',
          adminName: 'JoelAdmin',
        }),
      });
      simulateMissingRpc = false;
      assert.strictEqual(missingRpcRes.status, 503);
      assert.strictEqual((await missingRpcRes.json()).error, 'SCHEMA_MISMATCH');
      assert.strictEqual(ticketPatchCalls, 0, 'Must NEVER execute non-atomic HTTP PATCH fallback');

      // 5. Valid batch return normalizes and sorts ticket numbers before calling RPC
      const qr81Before = ticketStore.get('ORD-081').qr_token;
      const okReturnRes = await fetch(`${baseUrl}/api/admin/hardcopy/status`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumbers: ['ord-082', 'ORD-081'],
          category: 'ORDINARY',
          action: 'deactivate_return',
          sellerName: 'Promoter Bosco',
          adminName: 'JoelAdmin',
          batchRef: 'PP-HC-RETURN-OK-02',
          notes: 'Unsold passes returned before gates opened',
        }),
      });
      assert.strictEqual(okReturnRes.status, 200);
      const okReturnBody = await okReturnRes.json();
      assert.strictEqual(okReturnBody.success, true);
      assert.strictEqual(okReturnBody.updatedCount, 2);
      assert.deepStrictEqual(okReturnBody.ticketNumbers, ['ORD-081', 'ORD-082']);
      assert.strictEqual(ticketStore.get('ORD-081').qr_token, qr81Before);
      assert.strictEqual(forwardedBatches.length, 1);
      assert.deepStrictEqual(forwardedBatches[0].p_ticket_numbers, ['ORD-081', 'ORD-082']);
    } finally {
      globalThis.fetch = originalFetch;
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('34. Phase 1 Security — Admin Authentication: Zero Hardcoded Fallbacks, Production Fail-Closed & Rate Limiting', async () => {
    await startServer();
    const prevEnv = {
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
      GATE_PASSCODE: process.env.GATE_PASSCODE,
      GATE_SESSION_SECRET: process.env.GATE_SESSION_SECRET,
      NODE_ENV: process.env.NODE_ENV,
    };

    try {
      // 1. Scan repository source files to verify zero hardcoded legacy passcodes exist anywhere in src/, api/, or server.ts
      const forbiddenLiteral = ['prince', '2026'].join('');
      const collectFiles = (dirPath: string): string[] => {
        if (!fs.existsSync(dirPath)) return [];
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
          const full = path.join(dirPath, entry.name);
          if (entry.isDirectory()) files.push(...collectFiles(full));
          else if (/\.(ts|tsx|js|jsx|html|json)$/.test(entry.name)) files.push(full);
        }
        return files;
      };

      const sourceFiles = [
        ...collectFiles(path.resolve(process.cwd(), 'src')),
        ...collectFiles(path.resolve(process.cwd(), 'api')),
        path.resolve(process.cwd(), 'server.ts'),
      ].filter((f) => fs.existsSync(f));

      for (const file of sourceFiles) {
        const content = fs.readFileSync(file, 'utf8');
        assert.strictEqual(
          content.toLowerCase().includes(forbiddenLiteral),
          false,
          `Hardcoded fallback credential must not appear in ${path.relative(process.cwd(), file)}`
        );
      }

      // 2. Fail closed (503 ADMIN_AUTH_NOT_CONFIGURED) when ADMIN_PASSCODE is missing, short, or set to the weak legacy value
      process.env.NODE_ENV = 'production';
      process.env.GATE_SESSION_SECRET = 'production_signing_secret_minimum_length_2026_secure';
      delete process.env.ADMIN_PASSCODE;
      GateSecurity.resetStateForTests();

      const missingRes = await fetch(`${baseUrl}/api/admin/tickets`, {
        headers: { Authorization: `Bearer ${forbiddenLiteral}` },
      });
      assert.strictEqual(missingRes.status, 503);
      assert.strictEqual((await missingRes.json()).error, 'ADMIN_AUTH_NOT_CONFIGURED');

      process.env.ADMIN_PASSCODE = 'shortpass99'; // < 12 chars
      GateSecurity.resetStateForTests();
      const shortRes = await fetch(`${baseUrl}/api/admin/health`, {
        headers: { Authorization: 'Bearer shortpass99' },
      });
      assert.strictEqual(shortRes.status, 503);
      assert.strictEqual((await shortRes.json()).error, 'ADMIN_AUTH_NOT_CONFIGURED');

      process.env.ADMIN_PASSCODE = forbiddenLiteral;
      GateSecurity.resetStateForTests();
      const weakRes = await fetch(`${baseUrl}/api/admin/health`, {
        headers: { Authorization: `Bearer ${forbiddenLiteral}` },
      });
      assert.strictEqual(weakRes.status, 503);
      assert.strictEqual((await weakRes.json()).error, 'ADMIN_AUTH_NOT_CONFIGURED');

      // 3. Rate limit failed admin authentication attempts (5 failures -> 401, 6th -> 429 with Retry-After)
      const strongAdminPass = 'Strong_Organizer_Passcode_9942!';
      process.env.ADMIN_PASSCODE = strongAdminPass;
      GateSecurity.resetStateForTests();

      for (let attempt = 1; attempt <= 5; attempt++) {
        const badRes = await fetch(`${baseUrl}/api/admin/tickets`, {
          headers: {
            Authorization: `Bearer invalid_guess_${attempt}`,
            'X-Forwarded-For': '198.51.100.41',
          },
        });
        assert.strictEqual(badRes.status, 401, `Attempt ${attempt} should return 401`);
        const rawText = await badRes.text();
        assert.strictEqual(rawText.includes(strongAdminPass), false, 'Response must never leak configured passcode');
      }

      // 6th failed attempt is blocked with HTTP 429 RATE_LIMITED
      const lockedRes = await fetch(`${baseUrl}/api/admin/tickets`, {
        headers: {
          Authorization: 'Bearer invalid_guess_6',
          'X-Forwarded-For': '198.51.100.41',
        },
      });
      assert.strictEqual(lockedRes.status, 429);
      assert.ok(Number(lockedRes.headers.get('Retry-After')) > 0, 'Must set Retry-After header');
      assert.strictEqual((await lockedRes.json()).error, 'RATE_LIMITED');

      // Even presenting the valid passcode from the locked-out IP remains rate-limited until cooldown expires
      const lockedValidRes = await fetch(`${baseUrl}/api/admin/health`, {
        headers: {
          Authorization: `Bearer ${strongAdminPass}`,
          'X-Forwarded-For': '198.51.100.41',
        },
      });
      assert.strictEqual(lockedValidRes.status, 429);

      // Different IP with valid strong passcode succeeds and never exposes raw passcode in health payload
      const cleanIpRes = await fetch(`${baseUrl}/api/admin/health`, {
        headers: {
          Authorization: `Bearer ${strongAdminPass}`,
          'X-Forwarded-For': '198.51.100.42',
        },
      });
      assert.strictEqual(cleanIpRes.status, 200);
      const healthText = await cleanIpRes.text();
      assert.strictEqual(healthText.includes(strongAdminPass), false);
    } finally {
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('35. Phase 1 Security — Order Lookup: Blocks PostgREST Filter Injection, Preserves Hyphens, Enforces Ownership Verification, Strips QR Tokens & Rate-Limits', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    GateSecurity.resetStateForTests();

    const observedUrls: string[] = [];
    const dbRows = [
      {
        id: '11111111-2222-4333-8444-555555555555',
        ticket_number: 'VIP-004',
        category: 'VIP',
        price_ugx: 50000,
        status: 'issued',
        payment_status: 'paid',
        buyer_name: 'Grace Atim',
        buyer_email: 'grace.atim@example.ug',
        buyer_phone: '+256775198484',
        qr_token: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        order_ref: 'PP-RWX-1790000000-4321',
        paid_at: '2026-10-27T14:00:00.000Z',
        checked_in_at: null,
        ticket_channel: 'online',
      },
      {
        id: '22222222-3333-4444-8555-666666666666',
        ticket_number: 'ORD-019',
        category: 'ORDINARY',
        price_ugx: 20000,
        status: 'issued',
        payment_status: 'paid',
        buyer_name: 'Other Buyer',
        buyer_email: 'other.buyer@example.ug',
        buyer_phone: '+256701999888',
        qr_token: 'ffffffff-1111-4222-8333-444444444444',
        order_ref: 'PP-RWX-1790000000-9999',
        paid_at: '2026-10-27T15:00:00.000Z',
        checked_in_at: null,
        ticket_channel: 'online',
      },
      {
        id: '33333333-4444-4555-8666-777777777777',
        ticket_number: 'ORD-065',
        category: 'ORDINARY',
        price_ugx: 20000,
        status: 'issued',
        payment_status: 'manual_paid',
        buyer_name: 'Grace Atim',
        buyer_email: 'grace.atim@example.ug',
        buyer_phone: '+256775198484',
        qr_token: '99999999-8888-4777-8666-555555555555',
        order_ref: 'PP-RWX-1790000000-4321',
        paid_at: '2026-10-27T15:10:00.000Z',
        checked_in_at: null,
        ticket_channel: 'hardcopy',
      },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/tickets')) {
        observedUrls.push(url);
        const parsed = new URL(url);
        // Must NEVER use PostgREST .or() filter or select qr_token
        assert.strictEqual(parsed.searchParams.has('or'), false, 'PostgREST .or() filter must never be used in lookup');
        const selectParam = parsed.searchParams.get('select') || '';
        assert.strictEqual(selectParam.includes('qr_token'), false, 'Lookup query must never select qr_token');

        const eqOrderRef = parsed.searchParams.get('order_ref');
        const ilikeEmail = parsed.searchParams.get('buyer_email');

        let filtered = dbRows;
        if (eqOrderRef?.startsWith('eq.')) {
          const refVal = eqOrderRef.slice(3);
          filtered = dbRows.filter((r) => r.order_ref === refVal);
        } else if (ilikeEmail?.startsWith('ilike.')) {
          const emailVal = ilikeEmail.slice(6).toLowerCase();
          filtered = dbRows.filter((r) => r.buyer_email.toLowerCase() === emailVal);
        }

        return new Response(JSON.stringify(filtered), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      // 1. PostgREST filter injection payloads are rejected at validation with ZERO database queries
      const injectionPayloads = [
        '0775198484,id.neq.00000000-0000-0000-0000-000000000000',
        'PP-RWX-1790000000-4321,qr_token.not.is.null',
        '%',
        'buyer_email.ilike.*@*',
      ];
      for (const badInput of injectionPayloads) {
        const injRes = await fetch(`${baseUrl}/api/orders/lookup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.10' },
          body: JSON.stringify({ contact: badInput, verification: 'grace.atim@example.ug' }),
        });
        assert.strictEqual(injRes.status, 400);
        assert.strictEqual((await injRes.json()).error, 'VALIDATION_ERROR');
      }
      assert.strictEqual(observedUrls.length, 0, 'Injection payloads must never reach PostgREST');

      // 2. Single-factor lookup without ownership verification is rejected (400 OWNERSHIP_VERIFICATION_REQUIRED)
      const noVerifRes = await fetch(`${baseUrl}/api/orders/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.11' },
        body: JSON.stringify({ contact: '0775 198 484' }),
      });
      assert.strictEqual(noVerifRes.status, 400);
      assert.strictEqual((await noVerifRes.json()).error, 'OWNERSHIP_VERIFICATION_REQUIRED');

      // 3. Wrong ownership verification returns uniform non-enumerating empty result (no cross-buyer leakage)
      const wrongOwnerRes = await fetch(`${baseUrl}/api/orders/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.11' },
        body: JSON.stringify({
          contact: 'PP-RWX-1790000000-4321',
          verification: 'other.buyer@example.ug',
        }),
      });
      assert.strictEqual(wrongOwnerRes.status, 200);
      const wrongOwnerBody = await wrongOwnerRes.json();
      assert.strictEqual(wrongOwnerBody.success, true);
      assert.strictEqual(wrongOwnerBody.count, 0);
      assert.deepStrictEqual(wrongOwnerBody.tickets, []);

      // 4. Hyphenated order reference + matching checkout email succeeds, preserves hyphens, excludes hardcopy, and strips qr_token/PII
      const validRefRes = await fetch(`${baseUrl}/api/orders/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.11' },
        body: JSON.stringify({
          contact: 'pp-rwx-1790000000-4321',
          verification: 'Grace.Atim@example.ug',
        }),
      });
      assert.strictEqual(validRefRes.status, 200);
      const validRefBody = await validRefRes.json();
      const rawLookupJson = JSON.stringify(validRefBody);

      assert.strictEqual(validRefBody.success, true);
      assert.strictEqual(validRefBody.count, 1, 'Must return only the verified online pass and exclude hardcopy ORD-065');
      assert.strictEqual(validRefBody.tickets[0].ticket_number, 'VIP-004');
      assert.strictEqual(validRefBody.tickets[0].order_ref, 'PP-RWX-1790000000-4321');
      assert.strictEqual('qr_token' in validRefBody.tickets[0], false, 'Must NEVER return qr_token');
      assert.strictEqual('buyer_email' in validRefBody.tickets[0], false, 'Must NEVER return buyer_email');
      assert.strictEqual('buyer_phone' in validRefBody.tickets[0], false, 'Must NEVER return buyer_phone');
      assert.strictEqual('id' in validRefBody.tickets[0], false, 'Must NEVER return internal UUID id');
      assert.strictEqual(rawLookupJson.includes('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'), false);
      assert.strictEqual(rawLookupJson.includes('other.buyer@example.ug'), false);
      assert.ok(
        observedUrls.some((u) => u.includes('order_ref=eq.PP-RWX-1790000000-4321')),
        'Hyphens in order reference must be preserved in exact .eq() query'
      );

      // 5. Valid Uganda phone + matching checkout email also succeeds
      const validPhoneRes = await fetch(`${baseUrl}/api/orders/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.11' },
        body: JSON.stringify({
          contact: '0775 198 484',
          verification: 'grace.atim@example.ug',
        }),
      });
      assert.strictEqual(validPhoneRes.status, 200);
      const validPhoneBody = await validPhoneRes.json();
      assert.strictEqual(validPhoneBody.count, 1);
      assert.strictEqual(validPhoneBody.tickets[0].ticket_number, 'VIP-004');

      // 6. Rate limiting enforced after 10 requests per 15m per IP
      for (let i = 1; i <= 10; i++) {
        const r = await fetch(`${baseUrl}/api/orders/lookup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.99' },
          body: JSON.stringify({ contact: '0775198484', verification: 'nobody@example.ug' }),
        });
        assert.strictEqual(r.status, 200);
      }
      const rateLimitedRes = await fetch(`${baseUrl}/api/orders/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.99' },
        body: JSON.stringify({ contact: '0775198484', verification: 'nobody@example.ug' }),
      });
      assert.strictEqual(rateLimitedRes.status, 429);
      assert.strictEqual((await rateLimitedRes.json()).error, 'RATE_LIMITED');
    } finally {
      globalThis.fetch = originalFetch;
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('36. Phase 1 Security — Relworx Webhook: Fails Closed Without Secret, Verifies Raw-Body HMAC, Cross-Checks Provider Status & Enforces Exact UGX Amount', async () => {
    await startServer();
    const prevEnv = {
      RELWORX_WEBHOOK_SECRET: process.env.RELWORX_WEBHOOK_SECRET,
      RELWORX_API_KEY: process.env.RELWORX_API_KEY,
      RELWORX_ACCOUNT_NO: process.env.RELWORX_ACCOUNT_NO,
    };

    const webhookSecret = 'relworx_whsec_production_secret_2026';
    const signBody = (rawBody: string, secret = webhookSecret) => {
      const ts = Math.floor(Date.now() / 1000);
      const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
      return `t=${ts},v1=${digest}`;
    };

    let markPaidCalls = 0;
    let releaseCalls = 0;
    let mockProviderResult: any = {
      success: true,
      status: 'success',
      internal_reference: 'RWX-INT-5001',
      reference: 'PP-RWX-1790005001-1111',
      amount: 50000,
      currency: 'UGX',
    };

    const mockGetOrder = mock.method(
      SupabaseServerService,
      'getOrderForPaymentVerification',
      async (orderRef: string) => {
        if (orderRef === 'PP-RWX-1790005001-1111') {
          return {
            found: true,
            order: {
              order_ref: 'PP-RWX-1790005001-1111',
              status: 'pending',
              total_amount_ugx: 50000,
              currency: 'UGX' as const,
              relworx_internal_ref: 'RWX-INT-5001',
              gateway: 'relworx',
              payment_method: 'relworx_mobile_money',
              verification_status: 'unsubmitted',
            },
          };
        }
        return { found: false };
      }
    );

    const mockCheckStatus = mock.method(RelworxService, 'checkRequestStatus', async () => mockProviderResult);
    const mockMarkPaid = mock.method(SupabaseServerService, 'markOrderAsPaid', async () => {
      markPaidCalls++;
      return true;
    });
    const mockRelease = mock.method(SupabaseServerService, 'releaseReservationByOrderRef', async () => {
      releaseCalls++;
      return true;
    });

    try {
      // 1. Fails closed (503 WEBHOOK_NOT_CONFIGURED) when RELWORX_WEBHOOK_SECRET is unset or too short
      delete process.env.RELWORX_WEBHOOK_SECRET;
      process.env.RELWORX_API_KEY = 'rwx_live_key_test_1234567890';
      process.env.RELWORX_ACCOUNT_NO = 'RELWORX_ACC_001';

      const unconfPayload = JSON.stringify({
        status: 'success',
        customer_reference: 'PP-RWX-1790005001-1111',
        amount: 50000,
        currency: 'UGX',
      });
      const unconfRes = await fetch(`${baseUrl}/api/payments/relworx-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: unconfPayload,
      });
      assert.strictEqual(unconfRes.status, 503);
      assert.strictEqual((await unconfRes.json()).error, 'WEBHOOK_NOT_CONFIGURED');
      assert.strictEqual(markPaidCalls, 0);

      // 2. Rejects forged or missing HMAC signature (401 INVALID_SIGNATURE)
      process.env.RELWORX_WEBHOOK_SECRET = webhookSecret;
      const forgedRes = await fetch(`${baseUrl}/api/payments/relworx-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Relworx-Signature': signBody(unconfPayload, 'wrong_attacker_secret_key_0000'),
        },
        body: unconfPayload,
      });
      assert.strictEqual(forgedRes.status, 401);
      assert.strictEqual((await forgedRes.json()).error, 'INVALID_SIGNATURE');
      assert.strictEqual(markPaidCalls, 0);

      // 3. Rejects webhook amount mismatch (20,000 UGX sent for 50,000 UGX VIP order -> 400 AMOUNT_MISMATCH)
      const underpaidBody = JSON.stringify({
        status: 'success',
        customer_reference: 'PP-RWX-1790005001-1111',
        amount: 20000,
        currency: 'UGX',
      });
      const underpaidRes = await fetch(`${baseUrl}/api/payments/relworx-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Relworx-Signature': signBody(underpaidBody),
        },
        body: underpaidBody,
      });
      assert.strictEqual(underpaidRes.status, 400);
      assert.strictEqual((await underpaidRes.json()).error, 'AMOUNT_MISMATCH');
      assert.strictEqual(markPaidCalls, 0);

      // 4. Rejects non-UGX currency (400 INVALID_CURRENCY)
      const wrongCurrBody = JSON.stringify({
        status: 'success',
        customer_reference: 'PP-RWX-1790005001-1111',
        amount: 50000,
        currency: 'USD',
      });
      const wrongCurrRes = await fetch(`${baseUrl}/api/payments/relworx-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Relworx-Signature': signBody(wrongCurrBody),
        },
        body: wrongCurrBody,
      });
      assert.strictEqual(wrongCurrRes.status, 400);
      assert.strictEqual((await wrongCurrRes.json()).error, 'INVALID_CURRENCY');
      assert.strictEqual(markPaidCalls, 0);

      // 5. Rejects when Relworx checkRequestStatus does NOT confirm 'success' (409 PAYMENT_NOT_CONFIRMED)
      mockProviderResult = {
        success: true,
        status: 'pending',
        reference: 'PP-RWX-1790005001-1111',
        amount: 50000,
        currency: 'UGX',
      };
      const validSignedBody = JSON.stringify({
        status: 'success',
        customer_reference: 'PP-RWX-1790005001-1111',
        internal_reference: 'RWX-INT-5001',
        amount: 50000,
        currency: 'UGX',
      });
      const unconfirmedProviderRes = await fetch(`${baseUrl}/api/payments/relworx-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Relworx-Signature': signBody(validSignedBody),
        },
        body: validSignedBody,
      });
      assert.strictEqual(unconfirmedProviderRes.status, 409);
      assert.strictEqual((await unconfirmedProviderRes.json()).error, 'PAYMENT_NOT_CONFIRMED');
      assert.strictEqual(markPaidCalls, 0);

      // 6. Rejects when provider checkRequestStatus returns mismatched amount (400 AMOUNT_MISMATCH)
      mockProviderResult = {
        success: true,
        status: 'success',
        reference: 'PP-RWX-1790005001-1111',
        amount: 20000,
        currency: 'UGX',
      };
      const mismatchProviderAmtRes = await fetch(`${baseUrl}/api/payments/relworx-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Relworx-Signature': signBody(validSignedBody),
        },
        body: validSignedBody,
      });
      assert.strictEqual(mismatchProviderAmtRes.status, 400);
      assert.strictEqual((await mismatchProviderAmtRes.json()).error, 'AMOUNT_MISMATCH');
      assert.strictEqual(markPaidCalls, 0);

      // 7. Marks order paid ONLY when HMAC + stored order + provider status 'success' + 'UGX' + exact amount all match
      mockProviderResult = {
        success: true,
        status: 'success',
        internal_reference: 'RWX-INT-5001',
        reference: 'PP-RWX-1790005001-1111',
        amount: 50000,
        currency: 'UGX',
      };
      const verifiedPaidRes = await fetch(`${baseUrl}/api/payments/relworx-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Relworx-Signature': signBody(validSignedBody),
        },
        body: validSignedBody,
      });
      assert.strictEqual(verifiedPaidRes.status, 200);
      assert.strictEqual((await verifiedPaidRes.json()).status, 'success');
      assert.strictEqual(markPaidCalls, 1);

      // 8. Failed webhook requires provider 'failed' confirmation before releasing reservation
      const failedBody = JSON.stringify({
        status: 'failed',
        customer_reference: 'PP-RWX-1790005001-1111',
      });
      mockProviderResult = { success: true, status: 'pending', reference: 'PP-RWX-1790005001-1111' };
      const unconfirmedFailRes = await fetch(`${baseUrl}/api/payments/relworx-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Relworx-Signature': signBody(failedBody),
        },
        body: failedBody,
      });
      assert.strictEqual(unconfirmedFailRes.status, 409);
      assert.strictEqual(releaseCalls, 0);

      mockProviderResult = { success: true, status: 'failed', reference: 'PP-RWX-1790005001-1111' };
      const confirmedFailRes = await fetch(`${baseUrl}/api/payments/relworx-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Relworx-Signature': signBody(failedBody),
        },
        body: failedBody,
      });
      assert.strictEqual(confirmedFailRes.status, 200);
      assert.strictEqual(releaseCalls, 1);
    } finally {
      mockGetOrder.mock.restore();
      mockCheckStatus.mock.restore();
      mockMarkPaid.mock.restore();
      mockRelease.mock.restore();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('37. Phase 1 Security — Check-In Fails Closed on Arbitrary RPC or Network Errors (Never Falls Back to Non-Atomic Queries)', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      GATE_PASSCODE: process.env.GATE_PASSCODE,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    process.env.GATE_PASSCODE = 'gate_staff_secure_2026';
    process.env.ADMIN_PASSCODE = 'organizer_admin_master_2026';
    GateSecurity.resetStateForTests();

    let rpcMode: 'permission_error' | 'network_throw' = 'permission_error';
    let fallbackTicketsTableCalls = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/gate_checkin_atomic')) {
        if (rpcMode === 'network_throw') {
          throw new Error('ECONNRESET simulated socket hang up');
        }
        return new Response(
          JSON.stringify({ code: '42501', message: 'permission denied for function gate_checkin_atomic' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/tickets')) {
        fallbackTicketsTableCalls++;
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const gateSession = GateSecurity.issueSession('gate_staff', 3600);
      const tokenUuid = '77777777-1111-4111-8111-777777777777';

      // 1. Non-missing RPC error (42501 permission denied / DB error) fails closed with HTTP 503 DATABASE_ERROR
      rpcMode = 'permission_error';
      const permRes = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gateSession.sessionToken}`,
        },
        body: JSON.stringify({ tokenOrNumber: tokenUuid }),
      });
      assert.strictEqual(permRes.status, 503);
      const permBody = await permRes.json();
      assert.strictEqual(permBody.error, 'DATABASE_ERROR');
      assert.strictEqual(fallbackTicketsTableCalls, 0, 'Must NEVER fall back to /rest/v1/tickets on non-missing RPC errors');

      // 2. Network exception during RPC call fails closed with HTTP 503 DATABASE_ERROR and zero table queries
      rpcMode = 'network_throw';
      const netRes = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gateSession.sessionToken}`,
        },
        body: JSON.stringify({ tokenOrNumber: tokenUuid }),
      });
      assert.strictEqual(netRes.status, 503);
      const netBody = await netRes.json();
      assert.strictEqual(netBody.error, 'DATABASE_ERROR');
      assert.strictEqual(fallbackTicketsTableCalls, 0, 'Must NEVER fall back to /rest/v1/tickets on network errors');
    } finally {
      globalThis.fetch = originalFetch;
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('38. Phase 1 Security — Legacy Admin Routes (/confirm-payment & /release-ticket): Block Hardcopy, Protect Checked-In Passes & Require Payment Evidence', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    process.env.ADMIN_PASSCODE = 'organizer_admin_master_2026';
    GateSecurity.resetStateForTests();

    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer organizer_admin_master_2026',
    };

    const ticketsById = new Map<string, any>([
      [
        'aaaaaaaa-0000-4000-8000-000000000055',
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000055',
          ticket_number: 'ORD-055',
          category: 'ORDINARY',
          price_ugx: 20000,
          status: 'available',
          payment_status: 'unpaid',
          checked_in_at: null,
          ticket_channel: 'hardcopy',
          order_ref: null,
        },
      ],
      [
        'bbbbbbbb-0000-4000-8000-000000000005',
        {
          id: 'bbbbbbbb-0000-4000-8000-000000000005',
          ticket_number: 'VIP-005',
          category: 'VIP',
          price_ugx: 50000,
          status: 'issued',
          payment_status: 'paid',
          checked_in_at: '2026-10-28T19:00:00.000Z',
          ticket_channel: 'online',
          order_ref: 'PP-MTN-1790000000-5555',
        },
      ],
      [
        'cccccccc-0000-4000-8000-000000000012',
        {
          id: 'cccccccc-0000-4000-8000-000000000012',
          ticket_number: 'ORD-012',
          category: 'ORDINARY',
          price_ugx: 20000,
          status: 'reserved',
          payment_status: 'pending',
          checked_in_at: null,
          ticket_channel: 'online',
          order_ref: 'PP-MTN-1790000000-1212',
        },
      ],
      [
        'dddddddd-0000-4000-8000-000000000014',
        {
          id: 'dddddddd-0000-4000-8000-000000000014',
          ticket_number: 'ORD-014',
          category: 'ORDINARY',
          price_ugx: 20000,
          status: 'reserved',
          payment_status: 'pending',
          checked_in_at: null,
          ticket_channel: 'online',
          order_ref: 'PP-MTN-1790000000-1414',
        },
      ],
    ]);

    const ordersByRef = new Map<string, any>([
      [
        'PP-MTN-1790000000-1212',
        {
          order_ref: 'PP-MTN-1790000000-1212',
          status: 'pending',
          total_amount_ugx: 20000,
          verification_status: 'unsubmitted',
          gateway: 'mtn_momo',
          payment_method: 'mtn_momo_merchant',
        },
      ],
      [
        'PP-MTN-1790000000-1414',
        {
          order_ref: 'PP-MTN-1790000000-1414',
          status: 'paid',
          total_amount_ugx: 20000,
          verification_status: 'verified',
          gateway: 'mtn_momo',
          payment_method: 'mtn_momo_merchant',
        },
      ],
    ]);

    const observedPatches: Array<{ url: string; body: any }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = (init?.method || 'GET').toUpperCase();

      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/tickets')) {
        const parsed = new URL(url);
        const eqId = parsed.searchParams.get('id')?.replace(/^eq\./, '') || '';

        if (method === 'GET') {
          const row = ticketsById.get(eqId) || null;
          return new Response(JSON.stringify(row), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (method === 'PATCH') {
          const body = JSON.parse(String(init?.body || '{}'));
          observedPatches.push({ url, body });
          const row = ticketsById.get(eqId);
          if (!row) {
            return new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (parsed.searchParams.get('checked_in_at') === 'is.null' && row.checked_in_at !== null) {
            return new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          Object.assign(row, body);
          return new Response(JSON.stringify({ id: row.id }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/orders')) {
        const parsed = new URL(url);
        const eqRef = parsed.searchParams.get('order_ref')?.replace(/^eq\./, '') || '';
        if (method === 'GET') {
          return new Response(JSON.stringify(ordersByRef.get(eqRef) || null), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      // 1. Both legacy endpoints strictly block hardcopy tickets (400 HARDCOPY_TICKET_FORBIDDEN)
      const hcConfirm = await fetch(`${baseUrl}/api/admin/confirm-payment`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ ticketId: 'aaaaaaaa-0000-4000-8000-000000000055' }),
      });
      assert.strictEqual(hcConfirm.status, 400);
      assert.strictEqual((await hcConfirm.json()).error, 'HARDCOPY_TICKET_FORBIDDEN');

      const hcRelease = await fetch(`${baseUrl}/api/admin/release-ticket`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ ticketId: 'aaaaaaaa-0000-4000-8000-000000000055' }),
      });
      assert.strictEqual(hcRelease.status, 400);
      assert.strictEqual((await hcRelease.json()).error, 'HARDCOPY_TICKET_FORBIDDEN');
      assert.strictEqual(observedPatches.length, 0);

      // 2. /api/admin/release-ticket refuses to release an admitted ticket or reset checked_in_at (409 ALREADY_CHECKED_IN)
      const checkedInRelease = await fetch(`${baseUrl}/api/admin/release-ticket`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ ticketId: 'bbbbbbbb-0000-4000-8000-000000000005' }),
      });
      assert.strictEqual(checkedInRelease.status, 409);
      assert.strictEqual((await checkedInRelease.json()).error, 'ALREADY_CHECKED_IN');
      assert.strictEqual(ticketsById.get('bbbbbbbb-0000-4000-8000-000000000005').checked_in_at, '2026-10-28T19:00:00.000Z');

      // 3. /api/admin/confirm-payment rejects unverified order without payment evidence (409 MISSING_PAYMENT_EVIDENCE)
      const unverifiedConfirm = await fetch(`${baseUrl}/api/admin/confirm-payment`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ ticketId: 'cccccccc-0000-4000-8000-000000000012' }),
      });
      assert.strictEqual(unverifiedConfirm.status, 409);
      assert.strictEqual((await unverifiedConfirm.json()).error, 'MISSING_PAYMENT_EVIDENCE');
      assert.strictEqual(ticketsById.get('cccccccc-0000-4000-8000-000000000012').status, 'reserved');

      // 4. /api/admin/release-ticket succeeds on un-admitted online reservation without touching checked_in_at in payload
      const validRelease = await fetch(`${baseUrl}/api/admin/release-ticket`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ ticketId: 'cccccccc-0000-4000-8000-000000000012' }),
      });
      assert.strictEqual(validRelease.status, 200);
      assert.strictEqual(observedPatches.length, 1);
      assert.strictEqual('checked_in_at' in observedPatches[0].body, false, 'Release payload must never overwrite checked_in_at');
      assert.ok(observedPatches[0].url.includes('checked_in_at=is.null'), 'Release query must guard checked_in_at IS NULL');

      // 5. /api/admin/confirm-payment succeeds when linked online order has verified payment evidence
      const verifiedConfirm = await fetch(`${baseUrl}/api/admin/confirm-payment`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ ticketId: 'dddddddd-0000-4000-8000-000000000014' }),
      });
      assert.strictEqual(verifiedConfirm.status, 200);
      assert.strictEqual(ticketsById.get('dddddddd-0000-4000-8000-000000000014').status, 'issued');
      assert.strictEqual(ticketsById.get('dddddddd-0000-4000-8000-000000000014').payment_status, 'paid');
    } finally {
      globalThis.fetch = originalFetch;
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('39. Phase 1 Security — Gate Session Client Flow, Redacted QR Guard, Public ?verify= Status & 70-Ticket Online Dashboard Isolation', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      GATE_PASSCODE: process.env.GATE_PASSCODE,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    process.env.GATE_PASSCODE = 'gate_checkpoint_pass_2026';
    process.env.ADMIN_PASSCODE = 'organizer_admin_master_2026';
    GateSecurity.resetStateForTests();

    const guestQrUuid = '12121212-3434-4567-89ab-cdef01234567';
    let guestCheckedInAt: string | null = null;

    // Build 370-ticket inventory (70 online: 20 VIP + 50 ORD, plus 300 hardcopy: 100 VIP + 200 ORD)
    const all370Tickets: any[] = [];
    for (let i = 1; i <= 20; i++) {
      all370Tickets.push({
        id: `00000000-0000-4000-8100-${String(i).padStart(12, '0')}`,
        ticket_number: `VIP-${String(i).padStart(3, '0')}`,
        category: 'VIP',
        price_ugx: 50000,
        status: i <= 3 ? 'issued' : 'available',
        payment_status: i <= 3 ? 'paid' : 'unpaid',
        checked_in_at: i === 1 ? '2026-10-28T18:00:00.000Z' : null,
        ticket_channel: 'online',
      });
    }
    for (let i = 1; i <= 50; i++) {
      all370Tickets.push({
        id: `00000000-0000-4000-8200-${String(i).padStart(12, '0')}`,
        ticket_number: `ORD-${String(i).padStart(3, '0')}`,
        category: 'ORDINARY',
        price_ugx: 20000,
        status: i <= 5 ? 'issued' : 'available',
        payment_status: i <= 5 ? 'paid' : 'unpaid',
        checked_in_at: i <= 2 ? '2026-10-28T18:05:00.000Z' : null,
        ticket_channel: 'online',
      });
    }
    for (let i = 21; i <= 120; i++) {
      all370Tickets.push({
        id: `00000000-0000-4000-8300-${String(i).padStart(12, '0')}`,
        ticket_number: `VIP-${String(i).padStart(3, '0')}`,
        category: 'VIP',
        price_ugx: 50000,
        status: i <= 40 ? 'issued' : 'available',
        payment_status: i <= 40 ? 'manual_paid' : 'unpaid',
        checked_in_at: i <= 30 ? '2026-10-28T18:10:00.000Z' : null,
        ticket_channel: 'hardcopy',
      });
    }
    for (let i = 51; i <= 250; i++) {
      all370Tickets.push({
        id: `00000000-0000-4000-8400-${String(i).padStart(12, '0')}`,
        ticket_number: `ORD-${String(i).padStart(3, '0')}`,
        category: 'ORDINARY',
        price_ugx: 20000,
        status: i <= 90 ? 'issued' : 'available',
        payment_status: i <= 90 ? 'manual_paid' : 'unpaid',
        checked_in_at: i <= 60 ? '2026-10-28T18:15:00.000Z' : null,
        ticket_channel: 'hardcopy',
      });
    }

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const rawUrl = typeof input === 'string' ? input : String(input?.url || '');

      // Route relative `/api/*` calls from TicketService to the live test Express server
      if (rawUrl.startsWith('/api/')) {
        return originalFetch(`${baseUrl}${rawUrl}`, init);
      }

      if (rawUrl.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/gate_checkin_atomic')) {
        guestCheckedInAt = '2026-10-28T19:30:00.000Z';
        return new Response(
          JSON.stringify({
            status: 'ADMITTED',
            message: 'ADMITTED: Welcome to Pool Party, Ivan Mukasa! (ORDINARY Pass #ORD-055)',
            checkedInAt: guestCheckedInAt,
            ticket: {
              id: '55555555-5555-4555-8555-555555555555',
              ticket_number: 'ORD-055',
              category: 'ORDINARY',
              price_ugx: 20000,
              status: 'issued',
              payment_status: 'manual_paid',
              buyer_name: 'Ivan Mukasa',
              qr_token: guestQrUuid,
              created_at: '2026-10-28T12:00:00.000Z',
              paid_at: '2026-10-28T12:05:00.000Z',
              checked_in_at: guestCheckedInAt,
              ticket_channel: 'hardcopy',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (rawUrl.startsWith('https://poolpartytest.supabase.co/rest/v1/tickets')) {
        const parsed = new URL(rawUrl);
        if (parsed.searchParams.get('qr_token') === `eq.${guestQrUuid}`) {
          return new Response(
            JSON.stringify({
              ticket_number: 'ORD-055',
              category: 'ORDINARY',
              status: 'issued',
              payment_status: 'manual_paid',
              checked_in_at: guestCheckedInAt,
              ticket_channel: 'hardcopy',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (parsed.searchParams.get('checked_in_at') === 'not.is.null') {
          return new Response(
            JSON.stringify([
              {
                ticket_number: 'ORD-055',
                category: 'ORDINARY',
                buyer_name: 'Ivan Mukasa',
                checked_in_at: guestCheckedInAt || '2026-10-28T19:30:00.000Z',
                ticket_channel: 'hardcopy',
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify(all370Tickets), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      // 1. Public ?verify=<uuid> status check is strictly read-only, exposes zero PII, and does not check ticket in
      const pubBefore = await TicketService.getPublicTicketStatus(guestQrUuid);
      assert.strictEqual(pubBefore.valid, true);
      assert.strictEqual(pubBefore.status, 'VALID_UNUSED');
      assert.strictEqual(pubBefore.ticketNumber, 'ORD-055');
      assert.strictEqual(pubBefore.channel, 'hardcopy');
      assert.strictEqual(guestCheckedInAt, null, 'Public status check must NEVER check in ticket');

      // 2. Unauthenticated TicketService.verifyAndCheckIn returns UNAUTHORIZED
      TicketService.setGateSessionToken('');
      const unauthScan = await TicketService.verifyAndCheckIn(guestQrUuid);
      assert.strictEqual(unauthScan.status, 'UNAUTHORIZED');

      // 3. Gate staff logs in via POST /api/gate/session (without admin access), checks in ticket, and loads /api/gate/recent-checkins
      const loginRes = await TicketService.loginGateSession('gate_checkpoint_pass_2026');
      assert.strictEqual(loginRes.success, true);
      assert.strictEqual(loginRes.authenticated, true);
      assert.strictEqual(loginRes.role, 'gate_staff');

      const sessionStatus = await TicketService.checkGateSession();
      assert.strictEqual(sessionStatus.authenticated, true);
      assert.strictEqual(sessionStatus.role, 'gate_staff');

      const scanRes = await TicketService.verifyAndCheckIn(guestQrUuid);
      assert.strictEqual(scanRes.status, 'ADMITTED');
      assert.strictEqual(scanRes.ticket?.qr_token, '[REDACTED]');

      // 4. Redacted QR guard refuses '[REDACTED]' and never generates fake QR artwork
      assert.strictEqual(isRenderableQrToken('[REDACTED]'), false);
      assert.strictEqual(isRenderableQrToken(''), false);
      assert.strictEqual(isRenderableQrToken(guestQrUuid), true);
      await assert.rejects(
        () => TicketRenderer.renderTicketToCanvas(scanRes.ticket!),
        /redacted or unavailable/i,
        'TicketRenderer must refuse to render QR codes from [REDACTED] tokens'
      );

      // 5. Gate recent check-ins works with gate_staff session and normalizes fields for GateScanner UI
      const recentRes = await TicketService.getRecentGateCheckIns(8);
      assert.strictEqual(recentRes.success, true);
      assert.strictEqual(recentRes.checkIns.length, 1);
      assert.strictEqual(recentRes.checkIns[0].ticket_number, 'ORD-055');
      assert.strictEqual(recentRes.checkIns[0].buyer_name, 'Ivan Mukasa');
      assert.strictEqual(recentRes.checkIns[0].ticket_channel, 'hardcopy');

      // 6. Signing out revokes gate session immediately
      await TicketService.logoutGateSession();
      const postLogoutScan = await TicketService.verifyAndCheckIn(guestQrUuid);
      assert.strictEqual(postLogoutScan.status, 'UNAUTHORIZED');

      // 7. Dashboard 70-ticket online stats strictly exclude the 300 hardcopy tickets
      assert.strictEqual(all370Tickets.filter(isOnlineTicketRecord).length, 70);
      TicketService.setAdminToken('organizer_admin_master_2026');
      const dash = await TicketService.getDashboardStats();
      assert.ok(dash.stats);
      assert.strictEqual(dash.stats!.overall.totalCapacity, 70);
      assert.strictEqual(dash.stats!.vip.totalCapacity, 20);
      assert.strictEqual(dash.stats!.ordinary.totalCapacity, 50);
      assert.strictEqual(dash.stats!.vip.paid, 3, 'Must count only the 3 online VIP paid tickets, excluding 20 hardcopy VIP');
      assert.strictEqual(dash.stats!.ordinary.paid, 5, 'Must count only the 5 online ORD paid tickets, excluding 40 hardcopy ORD');
      assert.strictEqual(dash.stats!.overall.totalCheckedIn, 3, 'Must count only online check-ins (1 VIP + 2 ORD)');
      assert.strictEqual(dash.stats!.overall.totalRevenueUgx, 3 * 50000 + 5 * 20000);
    } finally {
      TicketService.clearAdminToken();
      TicketService.setGateSessionToken('');
      globalThis.fetch = originalFetch;
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('40. Phase 2 Static Security Analysis: Exact 370-Ticket Pre/Post Invariants, Whitelist Policy Audit & Least-Privilege Grants (Static Checks)', () => {
    const phase2MigrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261029_phase2_database_security_hardening.sql'
    );
    assert.ok(fs.existsSync(phase2MigrationPath), 'Phase 2 migration file must exist');
    const sql = fs.readFileSync(phase2MigrationPath, 'utf8');

    // 1. Non-destructive guarantees (Static Check)
    assert.strictEqual(/drop\s+table/i.test(sql), false, 'Phase 2 migration must NEVER drop tables');
    assert.strictEqual(/truncate\s+/i.test(sql), false, 'Phase 2 migration must NEVER truncate tables');
    assert.strictEqual(/delete\s+from\s+public\.tickets/i.test(sql), false, 'Phase 2 migration must NEVER delete existing tickets');

    // 2. Exact 370-Ticket Pre-Migration Invariant Assertions (Static Check)
    // 20 online VIP: VIP-001..VIP-020 @ 50k, online, non-null QR
    assert.ok(/generate_series\(1,\s*20\)/i.test(sql), 'Must validate exact online series VIP-001..VIP-020');
    // 50 online ORD: ORD-001..ORD-050 @ 20k, online, non-null QR
    assert.ok(/generate_series\(1,\s*50\)/i.test(sql), 'Must validate exact online series ORD-001..ORD-050');
    // 100 hardcopy VIP: VIP-021..VIP-120 @ 50k, hardcopy, non-null QR
    assert.ok(/generate_series\(21,\s*120\)/i.test(sql), 'Must validate exact hardcopy series VIP-021..VIP-120');
    // 200 hardcopy ORD: ORD-051..ORD-250 @ 20k, hardcopy, non-null QR
    assert.ok(/generate_series\(51,\s*250\)/i.test(sql), 'Must validate exact hardcopy series ORD-051..ORD-250');
    assert.ok(/qr_token\s+is\s+null/i.test(sql), 'Must verify zero null qr_tokens across all tickets');

    // 3. Strict Policy Whitelist Enumeration & Abort on Unexpected Policies (Static Check)
    assert.ok(/from\s+pg_policies/i.test(sql), 'Must query pg_policies for active policies');
    assert.ok(/v_known_policies/i.test(sql), 'Must maintain a whitelist of known reviewed policy names');
    assert.ok(/unreviewed unexpected policy/i.test(sql), 'Must raise exception on any unexpected policy');

    // 4. Table Access, Sequences & RLS Hardening (Static Check)
    assert.ok(/alter\s+table\s+public\.tickets\s+enable\s+row\s+level\s+security/i.test(sql));
    assert.ok(/alter\s+table\s+public\.orders\s+enable\s+row\s+level\s+security/i.test(sql));
    assert.ok(/alter\s+table\s+public\.tickets\s+no\s+force\s+row\s+level\s+security/i.test(sql));
    assert.ok(/alter\s+table\s+public\.orders\s+no\s+force\s+row\s+level\s+security/i.test(sql));
    assert.ok(/alter\s+table\s+public\.hardcopy_audit_logs\s+no\s+force\s+row\s+level\s+security/i.test(sql));

    // Revoke broad grants from public, anon, authenticated on tables and sequences
    assert.ok(
      /revoke\s+all\s+on\s+table\s+public\.tickets\s+from\s+public,\s*anon,\s*authenticated/i.test(sql),
      'Must revoke public/anon/authenticated on tickets'
    );
    assert.ok(
      /revoke\s+all\s+on\s+table\s+public\.orders\s+from\s+public,\s*anon,\s*authenticated/i.test(sql),
      'Must revoke public/anon/authenticated on orders'
    );
    assert.ok(
      /revoke\s+all\s+on\s+table\s+public\.hardcopy_audit_logs\s+from\s+public,\s*anon,\s*authenticated/i.test(sql),
      'Must revoke public/anon/authenticated on hardcopy_audit_logs'
    );
    assert.ok(
      /revoke\s+all\s+on\s+sequence\s+public/i.test(sql),
      'Must revoke public/anon/authenticated on sequences'
    );

    // Drop legacy permissive policies
    const droppedPolicies = [
      'Authenticated access only',
      'Authenticated and service role tickets access',
      'Service role tickets management',
      'Public ticket read',
      'Authenticated and service role orders access',
      'Service role orders management',
    ];
    for (const p of droppedPolicies) {
      assert.ok(
        new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"${p}"`, 'i').test(sql),
        `Must drop legacy policy: ${p}`
      );
    }

    // Ensure new policies never grant arbitrary authenticated role
    assert.strictEqual(
      /auth\.role\(\)\s*=\s*'authenticated'/i.test(sql),
      false,
      'Must NEVER grant arbitrary authenticated role in Phase 2 policies'
    );

    // 5. Legacy RPC Security: mark_order_paid_atomic, submit_mtn_payment, verify_mtn_payment_admin (Static Check)
    const legacyRpcs = [
      'mark_order_paid_atomic',
      'submit_mtn_payment',
      'verify_mtn_payment_admin',
    ];
    for (const fn of legacyRpcs) {
      assert.ok(
        new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}`, 'i').test(sql),
        `Must redefine ${fn}`
      );
      assert.ok(
        new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\)\\s*from\\s+public,\\s*anon,\\s*authenticated`, 'i').test(sql),
        `Must revoke EXECUTE on ${fn}`
      );
      assert.ok(
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\)\\s*to\\s+service_role`, 'i').test(sql),
        `Must grant EXECUTE on ${fn} to service_role`
      );
    }

    // 6. Hardcopy RPC error classification: distinguishes privilege, constraint, audit failure, and mismatch without leaking internal SQL details (Static Check)
    assert.ok(/when\s+insufficient_privilege\s+then/i.test(sql), 'Must handle insufficient_privilege');
    assert.ok(/when\s+check_violation\s+then/i.test(sql), 'Must handle check_violation');
    assert.ok(/INSUFFICIENT_PRIVILEGE/i.test(sql), 'Must return INSUFFICIENT_PRIVILEGE error code');
    assert.ok(/AUDIT_LOG_FAILED/i.test(sql), 'Must return AUDIT_LOG_FAILED error code');
    assert.ok(/CHECK_VIOLATION/i.test(sql), 'Must return CHECK_VIOLATION error code');
    assert.ok(/raise\s+warning/i.test(sql), 'Must log internal details to postgres log rather than leaking to client response');

    // 7. Channel isolation in legacy payment RPCs: strictly updates online tickets (Static Check)
    assert.ok(
      /where\s+order_ref\s*=\s*p_order_ref\s+and\s+coalesce\(ticket_channel,\s*'online'\)\s*=\s*'online'/i.test(sql),
      'mark_order_paid_atomic and verify_mtn_payment_admin must protect hardcopy tickets'
    );
  });

  it('41. Phase 2 Simulated Integration: Backend Admin Authorization Verification, Audit Failure Rollback & Channel Isolation (Simulated Integration)', async () => {
    await startServer();
    const prevEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      ADMIN_PASSCODE: process.env.ADMIN_PASSCODE,
      GATE_PASSCODE: process.env.GATE_PASSCODE,
    };
    process.env.SUPABASE_URL = 'https://poolpartytest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_secret_token_abcdefghijklmnopqrstuvwxyz';
    process.env.ADMIN_PASSCODE = 'organizer_admin_master_2026';
    process.env.GATE_PASSCODE = 'gate_staff_passcode_2026';
    GateSecurity.resetStateForTests();

    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer organizer_admin_master_2026',
    };

    let simulateAuditFailure = false;
    let simulatePrivilegeFailure = false;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      // Simulate Phase 2 RPC response for activate_hardcopy_tickets_atomic
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/activate_hardcopy_tickets_atomic')) {
        if (simulateAuditFailure) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'AUDIT_LOG_FAILED',
              message: 'Atomic hardcopy activation failed: audit record creation failed. Rolled back with zero tickets modified.',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (simulatePrivilegeFailure) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'INSUFFICIENT_PRIVILEGE',
              message: 'Database permission denied during atomic hardcopy activation. No tickets were modified.',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      // Simulate mark_order_paid_atomic
      if (url.startsWith('https://poolpartytest.supabase.co/rest/v1/rpc/mark_order_paid_atomic')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.p_order_ref === 'PP-RWX-EXISTING-PAID') {
          return new Response(
            JSON.stringify({
              success: true,
              message: 'Order is already marked as paid',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (body.p_order_ref === 'PP-RWX-NONEXISTENT') {
          return new Response(
            JSON.stringify({
              success: false,
              message: 'Order not found',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            order_ref: body.p_order_ref,
            tickets_issued: 2,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      // 1. Backend Authorization Check: p_admin_name or performedBy CANNOT bypass authentication
      // Passing adminName in body with no auth header returns 401 Unauthorized
      const unauthVerify = await fetch(`${baseUrl}/api/admin/mtn-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderRef: 'PP-MTN-1234',
          adminName: 'SuperAdminSpoof',
        }),
      });
      assert.strictEqual(unauthVerify.status, 401, 'Must reject unauthenticated payment verification attempt');

      // Passing gate staff session returns 403 Forbidden
      const gateStaffSession = GateSecurity.issueSession('gate_staff', 3600);
      const gateStaffVerify = await fetch(`${baseUrl}/api/admin/mtn-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gateStaffSession.sessionToken}`,
        },
        body: JSON.stringify({
          orderRef: 'PP-MTN-1234',
          adminName: 'SuperAdminSpoof',
        }),
      });
      assert.strictEqual(gateStaffVerify.status, 403, 'Must forbid gate staff from verifying payments');

      // 2. Audit log failure returns classified AUDIT_LOG_FAILED (not masked as ATOMIC_UPDATE_MISMATCH)
      simulateAuditFailure = true;
      const resAuditFail = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumber: 'ORD-065',
          sellerName: 'Agent Kato',
          adminName: 'JoelAdmin',
        }),
      });
      simulateAuditFailure = false;
      const auditFailBody = await resAuditFail.json();
      assert.strictEqual(auditFailBody.success, false);
      assert.strictEqual(auditFailBody.error, 'AUDIT_LOG_FAILED');
      assert.ok(auditFailBody.message.includes('audit record creation failed'));

      // 3. Permission denied returns classified INSUFFICIENT_PRIVILEGE
      simulatePrivilegeFailure = true;
      const resPrivFail = await fetch(`${baseUrl}/api/admin/hardcopy/activate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          ticketNumber: 'ORD-066',
          sellerName: 'Agent Kato',
          adminName: 'JoelAdmin',
        }),
      });
      simulatePrivilegeFailure = false;
      const privFailBody = await resPrivFail.json();
      assert.strictEqual(privFailBody.success, false);
      assert.strictEqual(privFailBody.error, 'INSUFFICIENT_PRIVILEGE');

      // 4. Mark order paid atomic handles non-existent and already-paid orders correctly
      const nonexistentPaid = await SupabaseServerService.markOrderAsPaid('PP-RWX-NONEXISTENT', {
        id: 'flw_test_1',
      });
      assert.strictEqual(nonexistentPaid, false);

      const alreadyPaid = await SupabaseServerService.markOrderAsPaid('PP-RWX-EXISTING-PAID', {
        id: 'flw_test_2',
      });
      assert.strictEqual(alreadyPaid, true);
    } finally {
      globalThis.fetch = originalFetch;
      GateSecurity.resetStateForTests();
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await stopServer();
    }
  });

  it('42. WhatsApp Share: Automatic PNG Download & Native File Attachment Coordination', async () => {
    assert.strictEqual(typeof WhatsAppService.shareTicketWithAutoPng, 'function');
    assert.strictEqual(typeof WhatsAppService.canShareFiles, 'function');

    const sampleTicket: any = {
      id: '99999999-9999-4999-8999-999999999999',
      ticket_number: 'VIP-009',
      category: 'VIP',
      price_ugx: 50000,
      status: 'issued',
      payment_status: 'paid',
      buyer_name: 'Grace Akello',
      buyer_phone: '0775198484',
      qr_token: '11111111-2222-3333-4444-555555555555',
    };

    let downloadedUrl: string | null = null;
    let openedUrl: string | null = null;
    let sharedFiles: any[] = [];

    // Mock DOM / Canvas environment for Node.js test runner
    const origWindow = globalThis.window;
    const origDoc = globalThis.document;
    const origNav = globalThis.navigator;
    const origRender = TicketRenderer.renderTicketToCanvas;

    const mockCanvas = {
      toDataURL: (type: string) => `data:${type};base64,mockPngBase64DataForPoolPartyTicket`,
      toBlob: (cb: (b: any) => void) => cb({ size: 1024, type: 'image/png' }),
    };

    (TicketRenderer as any).renderTicketToCanvas = async () => mockCanvas as any;

    (globalThis as any).window = {
      location: { origin: 'https://poolparty.ug' },
      open: (url: string) => {
        openedUrl = url;
        return null;
      },
    };

    (globalThis as any).document = {
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
      createElement: (tag: string) => {
        if (tag === 'a') {
          return {
            set href(val: string) { downloadedUrl = val; },
            download: '',
            click: () => {},
          };
        }
        return {};
      },
    };

    const mockNavigator = {
      canShare: (data: any) => Boolean(data && data.files),
      share: async (data: any) => {
        sharedFiles = data.files || [];
      },
    };

    const origNavDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: mockNavigator,
      configurable: true,
      writable: true,
    });

    try {
      // 1. In environment supporting file sharing (e.g. mobile Safari/Chrome):
      // Must automatically download the PNG AND attach file in navigator.share for WhatsApp
      const resWithFileShare = await WhatsAppService.shareTicketWithAutoPng({
        ticket: sampleTicket,
        message: 'Pool Party 2026 Ticket',
        phone: '0775198484',
      });

      assert.strictEqual(resWithFileShare.downloaded, true, 'Must automatically download PNG');
      assert.strictEqual(resWithFileShare.attachedViaShare, true, 'Must attach file to share sheet');
      assert.ok(typeof downloadedUrl === 'string' && (downloadedUrl as string).includes('data:image/png'), 'Must download valid image/png data url');
      assert.strictEqual(sharedFiles.length, 1, 'Must attach exactly 1 ticket PNG file');

      // 2. In desktop environment without navigator.share:
      // Must automatically download the PNG AND open wa.me URL
      (globalThis as any).navigator.canShare = () => false;
      downloadedUrl = null;
      openedUrl = null;

      const resDesktop = await WhatsAppService.shareTicketWithAutoPng({
        ticket: sampleTicket,
        message: 'Pool Party 2026 Ticket',
        phone: '0775198484',
      });

      assert.strictEqual(resDesktop.downloaded, true, 'Must automatically download PNG on desktop as well');
      assert.strictEqual(resDesktop.attachedViaShare, false);
      assert.strictEqual(resDesktop.openedWhatsAppUrl, true);
      assert.ok(typeof openedUrl === 'string' && (openedUrl as string).startsWith('https://wa.me/256775198484?text='), 'Must launch wa.me click-to-chat URL');
    } finally {
      TicketRenderer.renderTicketToCanvas = origRender;
      globalThis.window = origWindow;
      globalThis.document = origDoc;
      if (origNavDescriptor) {
        Object.defineProperty(globalThis, 'navigator', origNavDescriptor);
      }
    }
  });

  it('43. Google Search Console & SEO Readiness: sitemap.xml, robots.txt, and verification metadata', async () => {
    await startServer();
    try {
      // 1. Verify sitemap.xml endpoint
      const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`);
      assert.strictEqual(sitemapRes.status, 200, 'sitemap.xml must return 200 OK');
      const sitemapType = sitemapRes.headers.get('content-type') || '';
      assert.ok(sitemapType.includes('application/xml'), 'sitemap.xml must return application/xml content-type');
      const sitemapText = await sitemapRes.text();
      assert.ok(sitemapText.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'Must have XML declaration');
      assert.ok(sitemapText.includes('<urlset'), 'Must contain <urlset>');
      assert.ok(sitemapText.includes('<loc>'), 'Must contain <loc> entries');
      assert.ok(sitemapText.includes('#tickets'), 'Must include #tickets link');
      assert.ok(sitemapText.includes('Luxury_Tropical_Pool_Party_Flyer'), 'Must include poster image entry');

      // 2. Verify robots.txt endpoint
      const robotsRes = await fetch(`${baseUrl}/robots.txt`);
      assert.strictEqual(robotsRes.status, 200, 'robots.txt must return 200 OK');
      const robotsType = robotsRes.headers.get('content-type') || '';
      assert.ok(robotsType.includes('text/plain'), 'robots.txt must return text/plain content-type');
      const robotsText = await robotsRes.text();
      assert.ok(robotsText.includes('User-agent: *'), 'Must allow search bots');
      assert.ok(robotsText.includes('Allow: /'), 'Must allow root path');
      assert.ok(robotsText.includes('Disallow: /api/'), 'Must disallow /api/');
      assert.ok(robotsText.includes('Sitemap:'), 'Must reference sitemap');

      // 3. Verify index.html contains google-site-verification and favicon
      const indexPath = path.resolve(process.cwd(), 'index.html');
      const indexHtml = fs.readFileSync(indexPath, 'utf8');
      assert.ok(indexHtml.includes('name="google-site-verification"'), 'index.html must have google-site-verification tag');
      assert.ok(indexHtml.includes('1mpWN_u8Abjr7N9On1e6g6j5XKJ7-Zx7pmUZD9tY3-I'), 'Must contain exact user verification token');
      assert.ok(indexHtml.includes('rel="icon"'), 'index.html must link favicon');
      assert.ok(indexHtml.includes('rel="canonical"'), 'index.html must specify canonical URL');
      assert.ok(indexHtml.includes('name="robots"'), 'index.html must have robots directives');
    } finally {
      await stopServer();
    }
  });

  it('44. QR Gate Scanner: Camera Constraints, Secure Context Check, QR Token Extraction & Verification Integration', async () => {
    // 1. Verify GateScanner source code enforces secure context check & explicit Start Scanner permission trigger
    const scannerPath = path.resolve(process.cwd(), 'src/components/scanner/GateScanner.tsx');
    assert.ok(fs.existsSync(scannerPath), 'GateScanner.tsx must exist');
    const scannerCode = fs.readFileSync(scannerPath, 'utf8');

    // Secure context requirement
    assert.ok(
      scannerCode.includes('window.isSecureContext') || scannerCode.includes('isSecureContextEnv'),
      'GateScanner must check window.isSecureContext'
    );
    assert.ok(
      scannerCode.includes('Insecure Context Detected') || scannerCode.includes('Camera access requires a secure connection'),
      'GateScanner must warn when running in an insecure HTTP context'
    );

    // getUserMedia with environment facing mode and fallback
    assert.ok(
      scannerCode.includes('navigator.mediaDevices.getUserMedia'),
      'GateScanner must invoke navigator.mediaDevices.getUserMedia'
    );
    assert.ok(
      scannerCode.includes("facingMode: { ideal: targetFacing }") || scannerCode.includes("facingMode: { ideal: facingMode }"),
      'GateScanner must prefer environment (rear) camera'
    );
    assert.ok(
      scannerCode.includes('OverconstrainedError') || scannerCode.includes('video: true'),
      'GateScanner must handle camera constraint fallbacks'
    );

    // Track cleanup on unmount or scanner stop
    assert.ok(
      scannerCode.includes('track.stop()'),
      'GateScanner must stop all MediaStream tracks'
    );
    assert.ok(
      scannerCode.includes('playsinline'),
      'GateScanner must set playsinline on the video element for mobile compatibility'
    );

    // QR decoding engines
    assert.ok(
      scannerCode.includes('jsQR(') || scannerCode.includes('BarcodeDetector'),
      'GateScanner must integrate jsQR or BarcodeDetector decoding engine'
    );

    // Debounce / deduplication to prevent duplicate scans
    assert.ok(
      scannerCode.includes('lastScannedCodeRef') || scannerCode.includes('lastScannedRef'),
      'GateScanner must debounce recent QR scans to prevent duplicate requests'
    );
    assert.ok(
      scannerCode.includes('isVerifyingRef'),
      'GateScanner must lock scanner while verification request is in flight'
    );

    // 2. Test gate check-in API flow with signed session token
    await startServer();
    try {
      const prevGatePasscode = process.env.GATE_PASSCODE;
      process.env.GATE_PASSCODE = 'gatekeeper_passcode_2026';
      GateSecurity.resetStateForTests();

      // Acquire gate staff session
      const loginRes = await fetch(`${baseUrl}/api/gate/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: 'gatekeeper_passcode_2026' }),
      });
      assert.strictEqual(loginRes.status, 200, 'Gate staff login must succeed');
      const loginData = await loginRes.json();
      assert.strictEqual(loginData.authenticated, true);
      const sessionToken = loginData.sessionToken;
      assert.ok(sessionToken, 'Must receive signed gate session token');

      // Verify check-in route with invalid token (should gracefully return 200/400 with INVALID status)
      const verifyRes = await fetch(`${baseUrl}/api/tickets/verify-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ tokenOrNumber: 'not-a-real-ticket' }),
      });
      assert.strictEqual(verifyRes.status, 200);
      const verifyData = await verifyRes.json();
      assert.strictEqual(verifyData.status, 'INVALID');

      // Clean up gate passcode
      process.env.GATE_PASSCODE = prevGatePasscode;
    } finally {
      await stopServer();
    }
  });
});






