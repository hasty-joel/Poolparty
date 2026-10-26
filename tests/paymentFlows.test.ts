/**
 * Comprehensive Automated Payment Test Suite for Relworx Uganda Mobile Money
 * Tests:
 * 1. Successful payment & ticket issuance with QR token
 * 2. Failed/declined payment releasing reserved tickets back to available inventory
 * 3. Duplicate webhook notification idempotency (no duplicate tickets issued)
 * 4. Late payment race recovery (payment arriving after 10-minute reservation expiry)
 * 5. Incorrect amount and wrong currency rejection
 * 6. Relworx-Signature webhook authentication, HMAC validation & replay protection
 */

process.env.RELWORX_SIMULATE_TEST = 'true';

import { SupabaseServerService } from '../src/server/supabaseServer';
import { RelworxService } from '../src/server/relworxService';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAILED: ${message}`);
    failedTests++;
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('RUNNING RELWORX PAYMENT INTEGRATION AUDIT TESTS');
  console.log('======================================================\n');

  // ----------------------------------------------------------------------
  // TEST 1: Successful Payment & Ticket Issuance with QR Token
  // ----------------------------------------------------------------------
  console.log('TEST 1: Successful Payment & Ticket Issuance with QR Token');
  try {
    const initRes = await SupabaseServerService.initiateRelworxPayment({
      category: 'VIP',
      quantity: 1,
      buyerName: 'Amina Nakato',
      buyerEmail: 'amina.n@example.ug',
      buyerPhone: '+256772123456',
      network: 'MTN',
    });

    assert(initRes.success === true, 'Initiate payment returned success');
    assert(Boolean(initRes.orderRef), `Order reference generated: ${initRes.orderRef}`);
    assert(initRes.totalAmountUgx === 50000, 'VIP unit price strictly calculated as UGX 50,000');

    // Simulate confirmed Relworx webhook
    const markRes = await SupabaseServerService.markOrderAsPaid(initRes.orderRef!, {
      amount: 50000,
      currency: 'UGX',
      relworx_internal_ref: 'relworx_tx_test_success_001',
    });

    assert(markRes.success === true, 'Webhook marked order as paid successfully');
    assert(markRes.status === 'paid', 'Order status transitioned to paid');
    assert(markRes.issuedCount === 1, 'Exactly 1 VIP ticket issued');

    // Check Order Status returned to client
    const statusRes = await SupabaseServerService.getOrderStatus(initRes.orderRef!);
    assert(statusRes.status === 'paid', 'Polled order status is paid');
    assert(statusRes.tickets !== undefined && statusRes.tickets.length === 1, 'Client receives issued tickets');
    assert(Boolean(statusRes.tickets?.[0]?.qr_token), 'Issued ticket contains secure QR token');
    assert(statusRes.tickets?.[0]?.category === 'VIP', 'Issued ticket category is VIP');
  } catch (err: any) {
    assert(false, `Test 1 threw error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 2: Failed/Declined Payment Releasing Reserved Tickets
  // ----------------------------------------------------------------------
  console.log('\nTEST 2: Failed / Cancelled Payment Releases Reserved Tickets');
  try {
    const initRes = await SupabaseServerService.initiateRelworxPayment({
      category: 'ORDINARY',
      quantity: 2,
      buyerName: 'Robert Mukasa',
      buyerEmail: 'robert.m@example.ug',
      buyerPhone: '+256701987654',
      network: 'AIRTEL',
    });

    assert(initRes.success === true, 'Initiate payment returned success');
    const orderRef = initRes.orderRef!;

    // Customer declines prompt or cancels on handset
    const released = await SupabaseServerService.releaseReservationByOrderRef(orderRef);
    assert(released === true, 'Reservation released successfully upon cancellation');

    const statusRes = await SupabaseServerService.getOrderStatus(orderRef);
    assert(statusRes.status === 'failed' || statusRes.status === 'cancelled', 'Order status reflected as failed/cancelled');
    assert(!statusRes.tickets || statusRes.tickets.length === 0, 'No tickets issued for cancelled order');
  } catch (err: any) {
    assert(false, `Test 2 threw error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 3: Duplicate Webhook Notification Idempotency
  // ----------------------------------------------------------------------
  console.log('\nTEST 3: Duplicate Webhook Notification Idempotency');
  try {
    const initRes = await SupabaseServerService.initiateRelworxPayment({
      category: 'ORDINARY',
      quantity: 1,
      buyerName: 'Grace Kyomugisha',
      buyerEmail: 'grace.k@example.ug',
      buyerPhone: '+256782334455',
      network: 'MTN',
    });

    const orderRef = initRes.orderRef!;

    // First webhook delivery
    const firstCall = await SupabaseServerService.markOrderAsPaid(orderRef, {
      amount: 20000,
      currency: 'UGX',
      relworx_internal_ref: 'relworx_tx_test_dup_001',
    });
    assert(firstCall.success === true && firstCall.status === 'paid', 'First webhook payment processed');

    // Duplicate webhook delivery (Relworx retries or network replay)
    const secondCall = await SupabaseServerService.markOrderAsPaid(orderRef, {
      amount: 20000,
      currency: 'UGX',
      relworx_internal_ref: 'relworx_tx_test_dup_001',
    });

    assert(secondCall.success === true, 'Duplicate webhook handled cleanly');
    assert(secondCall.status === 'already_paid', 'Duplicate detected with already_paid status');
    assert(secondCall.issuedCount === 1, 'No duplicate tickets were minted');
  } catch (err: any) {
    assert(false, `Test 3 threw error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 4: Late Payment Race Recovery (Payment Arriving After 10m Expiry)
  // ----------------------------------------------------------------------
  console.log('\nTEST 4: Late Payment Race Recovery (Customer Paid but Webhook Arrived After 10m Expiry)');
  try {
    const initRes = await SupabaseServerService.initiateRelworxPayment({
      category: 'ORDINARY',
      quantity: 1,
      buyerName: 'Daniel Opolot',
      buyerEmail: 'daniel.o@example.ug',
      buyerPhone: '+256775667788',
      network: 'AIRTEL',
    });

    const orderRef = initRes.orderRef!;

    // Simulate 10-minute expiry cleanup
    await SupabaseServerService.releaseReservationByOrderRef(orderRef);

    // Customer actually completed mobile money transfer on phone! Relworx confirms payment.
    const lateRecovery = await SupabaseServerService.markOrderAsPaid(orderRef, {
      amount: 20000,
      currency: 'UGX',
      relworx_internal_ref: 'relworx_tx_test_late_001',
    });

    assert(lateRecovery.success === true, 'Late payment processed without error');
    assert(
      lateRecovery.status === 'recovered_and_paid' || lateRecovery.status === 'paid',
      `Late payment recovered safely with status: ${lateRecovery.status}`
    );
    assert(lateRecovery.issuedCount === 1, 'Customer tickets successfully allocated and issued despite delayed webhook');

    const statusRes = await SupabaseServerService.getOrderStatus(orderRef);
    assert(statusRes.status === 'paid', 'Late order is confirmed paid');
    assert(statusRes.tickets?.length === 1, 'Customer can view and download their ticket');
  } catch (err: any) {
    assert(false, `Test 4 threw error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 5: Incorrect Amount & Wrong Currency Rejection
  // ----------------------------------------------------------------------
  console.log('\nTEST 5: Incorrect Amount & Wrong Currency Rejection');
  try {
    const initRes = await SupabaseServerService.initiateRelworxPayment({
      category: 'VIP',
      quantity: 2,
      buyerName: 'Tamper Test',
      buyerEmail: 'tamper@test.ug',
      buyerPhone: '+256771000000',
      network: 'MTN',
    });

    const orderRef = initRes.orderRef!;
    assert(initRes.totalAmountUgx === 100000, 'Expected total is UGX 100,000 (2x VIP)');

    // Attempt 1: Tampered / Insufficient amount (paying 20,000 instead of 100,000)
    const badAmountRes = await SupabaseServerService.markOrderAsPaid(orderRef, {
      amount: 20000,
      currency: 'UGX',
      relworx_internal_ref: 'tampered_tx_001',
    });

    assert(badAmountRes.success === false, 'Tampered amount payment correctly rejected');
    assert(badAmountRes.error?.includes('AMOUNT_MISMATCH') === true, 'Error message explicitly flags AMOUNT_MISMATCH');

    // Attempt 2: Wrong currency (USD instead of UGX)
    const badCurrencyRes = await SupabaseServerService.markOrderAsPaid(orderRef, {
      amount: 100000,
      currency: 'USD',
      relworx_internal_ref: 'tampered_tx_002',
    });

    assert(badCurrencyRes.success === false, 'Wrong currency payment correctly rejected');
    assert(badCurrencyRes.error?.includes('CURRENCY_MISMATCH') === true, 'Error message explicitly flags CURRENCY_MISMATCH');

    // Verify order was NOT marked paid and no tickets were issued
    const finalStatus = await SupabaseServerService.getOrderStatus(orderRef);
    assert(finalStatus.status !== 'paid', 'Order remained unpaid after invalid payment attempts');
    assert(!finalStatus.tickets || finalStatus.tickets.length === 0, 'No tickets issued for fraudulent payment');
  } catch (err: any) {
    assert(false, `Test 5 threw error: ${err.message}`);
  }

  // ----------------------------------------------------------------------
  // TEST 6: Webhook Signature Verification Format & Replay Protection
  // ----------------------------------------------------------------------
  console.log('\nTEST 6: Relworx-Signature Webhook Verification & Replay Protection');
  try {
    const originalSecret = process.env.RELWORX_WEBHOOK_SECRET;

    // Test A: Sandbox mode when secret not set
    delete process.env.RELWORX_WEBHOOK_SECRET;
    const sandboxCheck = RelworxService.verifyWebhookSignature(undefined, { test: 123 });
    assert(sandboxCheck.valid === true, 'Allows sandbox testing when secret not configured');

    // Test B: Live secret with authentic signature
    const testSecret = 'live_secret_poolparty_uganda_2026';
    process.env.RELWORX_WEBHOOK_SECRET = testSecret;

    const testPayload = { customer_reference: 'PP-RWX-TEST', status: 'success', amount: 50000 };
    const nowSec = Math.floor(Date.now() / 1000);
    const validHeader = RelworxService.computeWebhookSignature(testSecret, testPayload, nowSec);

    const validCheck = RelworxService.verifyWebhookSignature(validHeader, testPayload);
    assert(validCheck.valid === true, 'Authentic HMAC-SHA256 signature verified successfully');

    // Test C: Replay attack (timestamp > 15 minutes old)
    const expiredTimestamp = nowSec - 1000;
    const replayHeader = RelworxService.computeWebhookSignature(testSecret, testPayload, expiredTimestamp);
    const replayCheck = RelworxService.verifyWebhookSignature(replayHeader, testPayload);
    assert(replayCheck.valid === false, 'Replay protection blocks webhooks older than 15 minutes');
    assert(replayCheck.reason?.includes('EXPIRED_TIMESTAMP') === true, 'Explicitly flags EXPIRED_TIMESTAMP');

    // Test D: Tampered payload
    const tamperedPayload = { ...testPayload, amount: 1000 };
    const tamperedCheck = RelworxService.verifyWebhookSignature(validHeader, tamperedPayload);
    assert(tamperedCheck.valid === false, 'Payload tampering detected and signature rejected');

    // Restore original env
    if (originalSecret) {
      process.env.RELWORX_WEBHOOK_SECRET = originalSecret;
    } else {
      delete process.env.RELWORX_WEBHOOK_SECRET;
    }
  } catch (err: any) {
    assert(false, `Test 6 threw error: ${err.message}`);
  }

  console.log('\n======================================================');
  console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite();
