import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPendingTicket,
  getTicketStatus,
  processIncomingSms,
  generateUniqueTicketRef,
} from '../src/server/smsListenerService.js';

test('SMS Listener Service - Ticket Lifecycle', async (t) => {
  await t.test('1. Generates unique ticket ref in POOL-XXXX format', async () => {
    const ref = await generateUniqueTicketRef();
    assert.match(ref, /^POOL-[0-9]{4}$/, `Expected POOL-XXXX format, got ${ref}`);
  });

  let createdRef = '';

  await t.test('2. Creates a pending ticket', async () => {
    const res = await createPendingTicket({
      name: 'John Kato',
      email: 'john.kato@example.ug',
      phone: '0772123456',
      amount: 50000,
    });

    assert.equal(res.success, true);
    assert.ok(res.ticketRef);
    assert.match(res.ticketRef!, /^POOL-[0-9]{4}$/);
    createdRef = res.ticketRef!;
  });

  await t.test('3. Retrieves pending ticket status', async () => {
    const res = await getTicketStatus(createdRef);
    assert.equal(res.success, true);
    assert.equal(res.ticketRef, createdRef);
    assert.equal(res.status, 'PENDING');
  });

  await t.test('4. Ignores SMS with no matching POOL reference', async () => {
    const res = await processIncomingSms({
      from: '165',
      text: 'Yello. You have received UGX 10,000 from 256770000000. Balance: UGX 100,000.',
    });

    assert.equal(res.success, true);
    assert.equal(res.matched, false);
  });

  await t.test('5. Processes MTN MoMo payment SMS matching ticket ref', async () => {
    const mtnSms = `Y'ello. You have received UGX 50,000 from 256772123456 (JOHN KATO) on 11/12/2026. Reason: ${createdRef}. Balance: UGX 350,000. Trans ID: 9988776655.`;
    const res = await processIncomingSms({
      from: '165',
      text: mtnSms,
    });

    assert.equal(res.success, true);
    assert.equal(res.matched, true);
    assert.equal(res.ticketRef, createdRef);
    assert.equal(res.status, 'PAID');
    assert.equal(res.telcoTransId, '9988776655');
  });

  await t.test('6. Verifies ticket status transitioned to PAID', async () => {
    const res = await getTicketStatus(createdRef);
    assert.equal(res.success, true);
    assert.equal(res.status, 'PAID');
  });

  await t.test('7. Processes Airtel Money payment SMS matching another ticket', async () => {
    const airtelTicket = await createPendingTicket({
      name: 'Sarah Namubiru',
      email: 'sarah@example.ug',
      phone: '0751987654',
      amount: 20000,
    });
    assert.equal(airtelTicket.success, true);
    const airtelRef = airtelTicket.ticketRef!;

    const airtelSms = `Trans.ID: AT11223344. Received UGX 20,000 from 256751987654. Ref: ${airtelRef}. New balance: UGX 80,000.`;
    const res = await processIncomingSms({
      from: 'AirtelMoney',
      text: airtelSms,
    });

    assert.equal(res.success, true);
    assert.equal(res.matched, true);
    assert.equal(res.ticketRef, airtelRef);
    assert.equal(res.status, 'PAID');

    const statusCheck = await getTicketStatus(airtelRef);
    assert.equal(statusCheck.status, 'PAID');
  });
});
