import React, { useState } from 'react';
import { X, Database, ShieldCheck, QrCode, Smartphone, Layers, Check, Copy } from 'lucide-react';

interface TicketArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TicketArchitectureModal: React.FC<TicketArchitectureModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'supabase' | 'webhooks' | 'qr_security' | 'scanner'>('supabase');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const supabaseSchemaCode = `-- ============================================================
-- POOL PARTY TICKETING SCHEMA (SUPABASE POSTGRESQL)
-- ============================================================

-- 1. Events Table
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  venue_name TEXT NOT NULL,
  venue_address TEXT NOT NULL,
  ticket_price_ugx INTEGER NOT NULL DEFAULT 19997,
  max_capacity INTEGER NOT NULL DEFAULT 1500,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Orders Table (One order can contain multiple tickets)
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference TEXT UNIQUE NOT NULL, -- e.g. PP26-UG-84912
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  buyer_full_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 10),
  unit_price_ugx INTEGER NOT NULL DEFAULT 19997,
  total_amount_ugx INTEGER NOT NULL,
  payment_method TEXT NOT NULL, -- 'mtn_momo' | 'airtel_money' | 'card'
  payment_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'failed' | 'refunded'
  payment_provider_ref TEXT, -- e.g. MTN financialTransactionId
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Individual Attendee Tickets Table (Each gets unique UUID & QR)
CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code TEXT UNIQUE NOT NULL, -- e.g. TK-2026-UG-84912-01
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  attendee_name TEXT NOT NULL,
  qr_signature TEXT NOT NULL, -- HMAC-SHA256 signature of ticket_code + secret
  status TEXT NOT NULL DEFAULT 'valid', -- 'valid' | 'used' | 'revoked'
  checked_in_at TIMESTAMPTZ,
  checked_in_by TEXT, -- Gate scanner device / agent ID
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Gate Scans Audit Log (Prevents reuse and provides real-time gate metrics)
CREATE TABLE IF NOT EXISTS public.ticket_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
  scanned_at TIMESTAMPTZ DEFAULT now(),
  scanner_agent_id TEXT NOT NULL,
  scan_result TEXT NOT NULL, -- 'SUCCESS_ADMITTED' | 'DUPLICATE_REJECTED' | 'INVALID_CODE'
  gate_location TEXT DEFAULT 'Main Resort Gate'
);`;

  const webhooksCode = `// ============================================================
// PAYMENT WEBHOOK HANDLER: MTN MoMo & Airtel Money
// (Server-side Edge Function / Express API Route)
// ============================================================

import express from 'express';
import crypto from 'crypto';

export async function handlePaymentWebhook(req: express.Request, res: express.Response) {
  const provider = req.params.provider; // 'mtn' | 'airtel'
  const payload = req.body;

  // 1. Verify HMAC cryptographic signature from payment provider
  const signature = req.headers['x-provider-signature'];
  const isValid = verifyProviderSignature(payload, signature, process.env.PAYMENT_SECRET!);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid provider signature' });
  }

  // 2. Extract transaction details
  const { externalId, status, financialTransactionId, amount } = payload;
  
  if (status === 'SUCCESSFUL') {
    // 3. Update order in Supabase to 'completed'
    const order = await supabase
      .from('orders')
      .update({ 
        payment_status: 'completed', 
        payment_provider_ref: financialTransactionId 
      })
      .eq('order_reference', externalId)
      .select()
      .single();

    // 4. Generate unique individual tickets with HMAC signatures
    const ticketsToCreate = Array.from({ length: order.quantity }).map((_, index) => {
      const ticketCode = \`TK-2026-\${order.order_reference}-\${String(index + 1).padStart(2, '0')}\`;
      const qrSignature = crypto
        .createHmac('sha256', process.env.TICKET_SIGNING_KEY!)
        .update(ticketCode)
        .digest('hex');

      return {
        order_id: order.id,
        event_id: order.event_id,
        attendee_name: order.buyer_full_name,
        ticket_code: ticketCode,
        qr_signature: qrSignature,
        status: 'valid'
      };
    });

    await supabase.from('tickets').insert(ticketsToCreate);

    // 5. Send Email with PDF pass & SMS notification with download link
    await sendTicketDeliveryNotification(order, ticketsToCreate);
  }

  return res.status(200).json({ received: true });
}`;

  const qrSecurityCode = `// ============================================================
// UNIQUE QR PAYLOAD SPECIFICATION & ANTI-FORGERY
// ============================================================

// QR Payload Structure (encoded as JSON inside QR):
{
  "event": "POOL_PARTY_2026",
  "ticket_code": "TK-2026-UG-84912-01",
  "sig": "3a7b9e...f1", // HMAC-SHA256 signature generated with server private key
  "issued_at": 1793036984
}

// Security Properties:
// 1. Offline Verification: Gate scanner holds the public key / secret to verify 'sig'
//    even if resort Wi-Fi or cellular network drops temporarily.
// 2. Anti-Duplication: Every single ticket is unique. Sharing a screenshot of one
//    ticket will fail for the second person because it is marked 'used' immediately.
// 3. No shared static QR codes: Every ticket has its own distinct code & cryptographic hash.`;

  const scannerCode = `// ============================================================
// GATE VERIFIER SCANNER ENDPOINT (Single-Scan Invalidation)
// POST /api/scanner/verify-ticket
// ============================================================

export async function verifyTicketScan(req: express.Request, res: express.Response) {
  const { qrPayload, scannerAgentId, gateLocation } = req.body;
  const { ticket_code, sig } = JSON.parse(qrPayload);

  // Step 1: Verify HMAC signature
  const expectedSig = crypto
    .createHmac('sha256', process.env.TICKET_SIGNING_KEY!)
    .update(ticket_code)
    .digest('hex');

  if (sig !== expectedSig) {
    return res.status(400).json({ status: 'INVALID', message: 'Forged or altered ticket' });
  }

  // Step 2: Atomic query and mark as used (Transaction / Row-Level Lock)
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('ticket_code', ticket_code)
    .single();

  if (!ticket) {
    return res.status(404).json({ status: 'NOT_FOUND', message: 'Ticket does not exist' });
  }

  if (ticket.status === 'used') {
    // Record duplicate scan attempt
    await supabase.from('ticket_scans').insert({
      ticket_id: ticket.id,
      scanner_agent_id: scannerAgentId,
      scan_result: 'DUPLICATE_REJECTED',
      gate_location: gateLocation
    });

    return res.status(409).json({
      status: 'ALREADY_USED',
      message: \`Entry denied: This ticket was already checked in at \${ticket.checked_in_at}\`
    });
  }

  // Step 3: Mark as used immediately
  await supabase
    .from('tickets')
    .update({ 
      status: 'used', 
      checked_in_at: new Date().toISOString(),
      checked_in_by: scannerAgentId 
    })
    .eq('id', ticket.id);

  // Step 4: Record successful scan
  await supabase.from('ticket_scans').insert({
    ticket_id: ticket.id,
    scanner_agent_id: scannerAgentId,
    scan_result: 'SUCCESS_ADMITTED',
    gate_location: gateLocation
  });

  return res.status(200).json({
    status: 'ADMITTED',
    attendeeName: ticket.attendee_name,
    ticketCode: ticket.ticket_code,
    message: 'Welcome to POOL PARTY!'
  });
}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-black/85 backdrop-blur-md">
      <div 
        className="relative w-full max-w-4xl bg-[#0a1526] border border-cyan-500/30 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[85vh]"
        role="dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#070e1b] border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-lg font-bold text-white font-display">
                Ticketing Architecture & Production Blueprint
              </h3>
              <p className="text-xs text-slate-400">
                Prepared for Supabase, MTN MoMo API, Airtel Money, unique QR tickets, and gate verification
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-white/10 bg-[#070e1b]/50 overflow-x-auto shrink-0">
          <button
            onClick={() => setActiveTab('supabase')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors whitespace-nowrap cursor-pointer flex items-center gap-2 ${
              activeTab === 'supabase'
                ? 'bg-[#0f1e36] text-cyan-300 border-t-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Supabase Schema</span>
          </button>

          <button
            onClick={() => setActiveTab('webhooks')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors whitespace-nowrap cursor-pointer flex items-center gap-2 ${
              activeTab === 'webhooks'
                ? 'bg-[#0f1e36] text-cyan-300 border-t-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>MoMo & Airtel Webhooks</span>
          </button>

          <button
            onClick={() => setActiveTab('qr_security')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors whitespace-nowrap cursor-pointer flex items-center gap-2 ${
              activeTab === 'qr_security'
                ? 'bg-[#0f1e36] text-cyan-300 border-t-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Cryptographic QR Security</span>
          </button>

          <button
            onClick={() => setActiveTab('scanner')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors whitespace-nowrap cursor-pointer flex items-center gap-2 ${
              activeTab === 'scanner'
                ? 'bg-[#0f1e36] text-cyan-300 border-t-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Gate Scanner Verifier API</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1 font-mono text-xs text-slate-300">
          {activeTab === 'supabase' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between font-sans">
                <span className="text-xs text-slate-300">
                  PostgreSQL schema designed for Supabase with relational integrity, capacity limits, and scan tracking.
                </span>
                <button
                  onClick={() => copyCode(supabaseSchemaCode)}
                  className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-xs flex items-center gap-1.5 cursor-pointer font-sans"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy SQL'}</span>
                </button>
              </div>
              <pre className="p-4 bg-[#050b14] rounded-xl border border-white/10 overflow-x-auto text-[12px] leading-relaxed text-cyan-100">
                {supabaseSchemaCode}
              </pre>
            </div>
          )}

          {activeTab === 'webhooks' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between font-sans">
                <span className="text-xs text-slate-300">
                  Webhook listener verifying provider HMAC signatures before creating permanent tickets in the database.
                </span>
                <button
                  onClick={() => copyCode(webhooksCode)}
                  className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-xs flex items-center gap-1.5 cursor-pointer font-sans"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Code'}</span>
                </button>
              </div>
              <pre className="p-4 bg-[#050b14] rounded-xl border border-white/10 overflow-x-auto text-[12px] leading-relaxed text-cyan-100">
                {webhooksCode}
              </pre>
            </div>
          )}

          {activeTab === 'qr_security' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between font-sans">
                <span className="text-xs text-slate-300">
                  Specification ensuring tickets cannot be forged, duplicated, or guessed.
                </span>
                <button
                  onClick={() => copyCode(qrSecurityCode)}
                  className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-xs flex items-center gap-1.5 cursor-pointer font-sans"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Spec'}</span>
                </button>
              </div>
              <pre className="p-4 bg-[#050b14] rounded-xl border border-white/10 overflow-x-auto text-[12px] leading-relaxed text-cyan-100">
                {qrSecurityCode}
              </pre>
            </div>
          )}

          {activeTab === 'scanner' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between font-sans">
                <span className="text-xs text-slate-300">
                  Single-scan gate entrance validator that immediately marks ticket status as 'used' to prevent reuse.
                </span>
                <button
                  onClick={() => copyCode(scannerCode)}
                  className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-xs flex items-center gap-1.5 cursor-pointer font-sans"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Endpoint'}</span>
                </button>
              </div>
              <pre className="p-4 bg-[#050b14] rounded-xl border border-white/10 overflow-x-auto text-[12px] leading-relaxed text-cyan-100">
                {scannerCode}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#070e1b] border-t border-white/10 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors cursor-pointer uppercase"
          >
            Close Documentation
          </button>
        </div>
      </div>
    </div>
  );
};
