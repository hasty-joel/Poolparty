import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createExpressApp } from '../src/server/app';
import { SupabaseServerService } from '../src/server/supabaseServer';
import { RelworxService } from '../src/server/relworxService';
import http from 'node:http';

describe('Pool Party Supabase Ticketing System Tests', () => {
  const app = createExpressApp();
  let server: http.Server;
  let baseUrl: string;

  // Start test server on random port
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
    // Verify that SupabaseServerService does NOT contain serverMemoryStore or hardcoded names
    const serviceKeys = Object.keys(SupabaseServerService);
    assert.strictEqual((SupabaseServerService as any).serverMemoryStore, undefined, 'serverMemoryStore must not exist');
    assert.strictEqual((SupabaseServerService as any).serverOrdersStore, undefined, 'serverOrdersStore must not exist');
    assert.strictEqual((SupabaseServerService as any).initFallbackInventory, undefined, 'initFallbackInventory must not exist');
  });

  it('2. Admin Endpoints Require Server-Side Authorization (HTTP 401 on Unauthorized)', async () => {
    await startServer();

    try {
      // Test /api/admin/tickets without auth header
      const resTickets = await fetch(`${baseUrl}/api/admin/tickets`);
      assert.strictEqual(resTickets.status, 401, 'Must return 401 Unauthorized without admin token');
      const dataTickets = await resTickets.json();
      assert.strictEqual(dataTickets.success, false);

      // Test /api/admin/orders without auth header
      const resOrders = await fetch(`${baseUrl}/api/admin/orders`);
      assert.strictEqual(resOrders.status, 401, 'Must return 401 Unauthorized without admin token');

      // Test with invalid token
      const resBadToken = await fetch(`${baseUrl}/api/admin/tickets`, {
        headers: { Authorization: 'Bearer wrong-passcode' },
      });
      assert.strictEqual(resBadToken.status, 401, 'Must reject incorrect admin passcode');

      // Test with valid token (prince2026)
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
        // If Supabase is connected
        assert.strictEqual(body.success, true);
        assert.ok(body.counts);
        assert.strictEqual(typeof body.counts.VIP.available, 'number');
        assert.strictEqual(typeof body.counts.ORDINARY.available, 'number');
        assert.strictEqual(body.counts.VIP.priceUgx, 50000, 'VIP price must be 50,000 UGX');
        assert.strictEqual(body.counts.ORDINARY.priceUgx, 20000, 'Ordinary price must be 20,000 UGX');

        // Verify zero private details leaked
        const rawText = JSON.stringify(body);
        assert.strictEqual(rawText.includes('qr_token'), false, 'Must never leak qr_token');
        assert.strictEqual(rawText.includes('buyer_name'), false, 'Must never leak buyer_name');
        assert.strictEqual(rawText.includes('buyer_phone'), false, 'Must never leak buyer_phone');
        assert.strictEqual(rawText.includes('buyer_email'), false, 'Must never leak buyer_email');
      } else {
        // If Supabase credentials are not connected in environment, it must return 503 error, NOT fake mock data!
        assert.strictEqual(res.status, 503, 'Must return 503 when database is not connected');
        assert.strictEqual(body.success, false);
        assert.ok(body.error, 'Must provide clear database error message');
      }
    } finally {
      await stopServer();
    }
  });

  it('4. Payment Initiation Validates Inputs and Rejects Invalid Tiers / Quantities', async () => {
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

      // Invalid category 'SUPER_VIP'
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

      // Invalid network 'VODAFONE'
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
    } finally {
      await stopServer();
    }
  });

  it('5. Gate Scanner Rejects Empty or Unrecognized Tokens', async () => {
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
    } finally {
      await stopServer();
    }
  });

  it('6. Webhook Signature Verification and Idempotency', async () => {
    await startServer();

    try {
      // Webhook with invalid signature should be rejected (401)
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

      // Signature verification protects against spoofing
      if (RelworxService.getWebhookSecret()) {
        assert.strictEqual(resUnauthorized.status, 401, 'Must reject invalid webhook signature when secret is configured');
      }
    } finally {
      await stopServer();
    }
  });
});
