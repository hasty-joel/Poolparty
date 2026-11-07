import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import qrcode from 'qrcode';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

export interface PendingTicketInput {
  name: string;
  email: string;
  phone: string;
  amount: number;
}

export interface TicketRecord {
  id?: string;
  ticket_ref: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'USED';
  qr_token?: string;
  created_at?: string;
  paid_at?: string;
  checked_in_at?: string;
}

export interface SmsWebhookPayload {
  from?: string;
  sender?: string;
  phone?: string;
  text?: string;
  body?: string;
  message?: string;
  content?: string;
  timestamp?: string;
}

// In-memory fallback map if Supabase credentials are not provided
const _memoryTickets = new Map<string, TicketRecord>();

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url.includes('your-project') || key.length < 20) {
    return null;
  }
  try {
    return createClient(url, key, { auth: { persistSession: false } });
  } catch {
    return null;
  }
}

function getTransporter() {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_APP_PASSWORD;
  const emailHost = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const emailPort = parseInt(process.env.EMAIL_PORT || '465', 10);

  if (!emailUser || !emailPass) {
    return null;
  }

  return nodemailer.createTransport({
    host: emailHost,
    port: emailPort,
    secure: emailPort === 465,
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });
}

/**
 * Generates a unique 4-digit ticket reference code: POOL-XXXX
 */
export async function generateUniqueTicketRef(): Promise<string> {
  const supabase = getSupabaseClient();
  for (let attempt = 0; attempt < 15; attempt++) {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const candidateRef = `POOL-${randomDigits}`;

    if (supabase) {
      const { data, error } = await supabase
        .from('tickets')
        .select('id')
        .eq('ticket_ref', candidateRef)
        .maybeSingle();

      if (!error && !data) {
        return candidateRef;
      }
    } else {
      if (!_memoryTickets.has(candidateRef)) {
        return candidateRef;
      }
    }
  }
  return `POOL-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Creates a PENDING ticket in Supabase (or memory fallback)
 */
export async function createPendingTicket(input: PendingTicketInput): Promise<{ success: boolean; ticketRef?: string; error?: string }> {
  try {
    const ticketRef = await generateUniqueTicketRef();
    const supabase = getSupabaseClient();

    const record: TicketRecord = {
      ticket_ref: ticketRef,
      customer_name: input.name.trim(),
      customer_email: input.email.trim().toLowerCase(),
      customer_phone: input.phone.trim(),
      amount: input.amount,
      status: 'PENDING',
      created_at: new Date().toISOString(),
    };

    if (supabase) {
      const { data, error } = await supabase
        .from('tickets')
        .insert([record])
        .select('ticket_ref')
        .single();

      if (error) {
        console.error('[SmsListenerService] Supabase insert error:', error.message);
        // Fall back to memory map if table is not yet created
        _memoryTickets.set(ticketRef, record);
        return { success: true, ticketRef };
      }

      return { success: true, ticketRef: data.ticket_ref };
    }

    _memoryTickets.set(ticketRef, record);
    return { success: true, ticketRef };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Server error creating pending ticket' };
  }
}

/**
 * Queries ticket status by ticket_ref
 */
export async function getTicketStatus(ref: string): Promise<{ success: boolean; ticketRef?: string; status?: string; error?: string }> {
  try {
    const normalizedRef = ref.toUpperCase().trim();
    const supabase = getSupabaseClient();

    if (supabase) {
      const { data, error } = await supabase
        .from('tickets')
        .select('ticket_ref, status')
        .eq('ticket_ref', normalizedRef)
        .maybeSingle();

      if (!error && data) {
        return { success: true, ticketRef: data.ticket_ref, status: data.status };
      }

      // Check orders table
      const { data: orderData } = await supabase
        .from('orders')
        .select('order_ref, status')
        .eq('order_ref', normalizedRef)
        .maybeSingle();

      if (orderData) {
        return {
          success: true,
          ticketRef: orderData.order_ref,
          status: orderData.status === 'paid' ? 'PAID' : 'PENDING',
        };
      }
    }

    const memoryRecord = _memoryTickets.get(normalizedRef);
    if (memoryRecord) {
      return { success: true, ticketRef: memoryRecord.ticket_ref, status: memoryRecord.status };
    }

    return { success: false, error: `No ticket found for reference ${normalizedRef}.` };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Server error checking ticket status' };
  }
}

/**
 * Generates high-res QR code PNG buffer and emails inline CID ticket via Nodemailer
 */
export async function approveAndSendTicket(ticketRef: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    let ticket: TicketRecord | null = null;

    if (supabase) {
      const { data } = await supabase
        .from('tickets')
        .select('*')
        .eq('ticket_ref', ticketRef)
        .maybeSingle();
      if (data) ticket = data as TicketRecord;
    }

    if (!ticket) {
      ticket = _memoryTickets.get(ticketRef) || null;
    }

    if (!ticket) {
      console.warn(`[SmsListenerService] Ticket not found for delivery: ${ticketRef}`);
      return;
    }

    // 1. Generate high-resolution QR code PNG buffer
    const qrPayload = ticket.qr_token ? `${ticket.ticket_ref}:${ticket.qr_token}` : ticket.ticket_ref;
    const qrBuffer = await qrcode.toBuffer(qrPayload, {
      type: 'png',
      width: 500,
      margin: 2,
      color: {
        dark: '#080C14',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'H',
    });

    // 2. Prepare HTML Email with Inline CID Attachment
    const transporter = getTransporter();
    const formattedAmount = Number(ticket.amount).toLocaleString();

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #080C14; color: #FFFFFF; margin: 0; padding: 20px; }
          .container { max-width: 560px; margin: 0 auto; background-color: #0F172A; border-radius: 16px; border: 1px solid #1E293B; overflow: hidden; }
          .header { background: linear-gradient(135deg, #FFCC00 0%, #D97706 100%); padding: 32px 24px; text-align: center; color: #080C14; }
          .header h1 { margin: 0; font-size: 28px; font-weight: 800; }
          .content { padding: 32px 24px; }
          .details-card { background-color: #1E293B; border-radius: 12px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #FFCC00; }
          .detail-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
          .qr-box { background-color: #FFFFFF; border-radius: 16px; padding: 24px; text-align: center; margin: 24px 0; }
          .qr-img { width: 260px; height: 260px; display: block; margin: 0 auto; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #64748B; border-top: 1px solid #1E293B; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>POOL PARTY 2026</h1>
            <p>Official Admission Pass &bull; Prince Resort Bunamwaya</p>
          </div>
          <div class="content">
            <h2>Hello, ${ticket.customer_name}!</h2>
            <p>Your Mobile Money payment has been confirmed. Below is your official entry ticket and gate QR code.</p>
            <div class="details-card">
              <div class="detail-row"><span>Ticket Reference:</span><strong style="color: #FFCC00;">${ticket.ticket_ref}</strong></div>
              <div class="detail-row"><span>Amount Paid:</span><strong>UGX ${formattedAmount}</strong></div>
              <div class="detail-row"><span>Event Date:</span><strong>Friday, 11 Dec 2026 (12 PM - Late)</strong></div>
              <div class="detail-row"><span>Venue:</span><strong>Prince Resort, Bunamwaya (Bella), Uganda</strong></div>
            </div>
            <div class="qr-box">
              <img src="cid:ticket_qrcode" alt="Entry QR Code" class="qr-img" />
              <div style="color: #080C14; font-size: 13px; font-weight: 700; margin-top: 10px;">SCAN AT GATE FOR SINGLE ENTRY</div>
            </div>
          </div>
          <div class="footer">&copy; 2026 Pool Party Experience &bull; Bunamwaya Bella, Uganda</div>
        </div>
      </body>
      </html>
    `;

    if (transporter && process.env.EMAIL_USER) {
      await transporter.sendMail({
        from: `"Pool Party Bunamwaya" <${process.env.EMAIL_USER}>`,
        to: ticket.customer_email,
        subject: `🎟️ Confirmed: Your Pool Party Pass (${ticket.ticket_ref})`,
        html: emailHtml,
        attachments: [
          {
            filename: `Ticket-${ticket.ticket_ref}.png`,
            content: qrBuffer,
            cid: 'ticket_qrcode',
            contentType: 'image/png',
          },
        ],
      });
      console.log(`[SmsListenerService] Email sent to ${ticket.customer_email} for ${ticket.ticket_ref}`);
    } else {
      console.log(`[SmsListenerService] Email simulated for ${ticket.customer_email} (${ticket.ticket_ref}).`);
    }
  } catch (err: any) {
    console.error(`[SmsListenerService] approveAndSendTicket exception for ${ticketRef}:`, err?.message);
  }
}

/**
 * Parses raw SMS text and processes automated payment confirmation
 */
export async function processIncomingSms(payload: SmsWebhookPayload): Promise<{
  success: boolean;
  matched: boolean;
  ticketRef?: string;
  status?: string;
  telcoTransId?: string | null;
  message: string;
  error?: string;
}> {
  const smsText = String(payload.text || payload.body || payload.message || payload.content || '').trim();
  const sender = String(payload.from || payload.sender || payload.phone || '').trim();

  if (!smsText) {
    return { success: false, matched: false, message: 'Invalid payload: sms text body is required.' };
  }

  // 1. Ticket Reference Regex: POOL-XXXX (4 digits)
  const refRegex = /\b(POOL-\d{4})\b/i;
  const refMatch = smsText.match(refRegex);

  if (!refMatch) {
    return {
      success: true,
      matched: false,
      message: `SMS received from ${sender}, but did not contain a POOL-XXXX reference.`,
    };
  }

  const matchedRef = refMatch[1].toUpperCase();

  // 2. Amount Regex: UGX, Ush, UGX., Shs
  const amountRegex = /(?:UGX|USH|UGX\.|Shs\.?)\s*([\d,]+)/i;
  const amountMatch = smsText.match(amountRegex);
  const parsedAmount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ''), 10) : null;

  // 3. Telco Transaction ID Regex
  const transIdRegex = /(?:Trans\.?\s*ID|TID|Txn ID|ID|Ref)[\s:]+([A-Za-z0-9]+)/i;
  const transIdMatch = smsText.match(transIdRegex);
  const telcoTransId = transIdMatch ? transIdMatch[1] : null;

  const supabase = getSupabaseClient();
  let ticket: TicketRecord | null = null;

  if (supabase) {
    const { data } = await supabase
      .from('tickets')
      .select('*')
      .eq('ticket_ref', matchedRef)
      .maybeSingle();
    if (data) ticket = data as TicketRecord;

    if (!ticket) {
      const { data: orderData } = await supabase
        .from('orders')
        .select('*')
        .eq('order_ref', matchedRef)
        .maybeSingle();
      if (orderData) {
        ticket = {
          ticket_ref: orderData.order_ref,
          customer_name: orderData.buyer_name || 'Attendee',
          customer_email: orderData.buyer_email || '',
          customer_phone: orderData.buyer_phone || '',
          amount: orderData.total_amount_ugx || (orderData.category === 'VIP' ? 50000 : 20000),
          status: orderData.status === 'paid' ? 'PAID' : 'PENDING',
        };
      }
    }
  }

  if (!ticket) {
    ticket = _memoryTickets.get(matchedRef) || null;
  }

  if (!ticket) {
    return {
      success: false,
      matched: true,
      ticketRef: matchedRef,
      message: `Parsed reference ${matchedRef} does not match any record.`,
    };
  }

  if (ticket.status === 'PAID') {
    return {
      success: true,
      matched: true,
      ticketRef: matchedRef,
      status: 'PAID',
      message: `Ticket ${matchedRef} is already marked as PAID.`,
    };
  }

  if (parsedAmount && parsedAmount < ticket.amount) {
    return {
      success: false,
      matched: true,
      ticketRef: matchedRef,
      error: `Underpayment: expected UGX ${ticket.amount}, received UGX ${parsedAmount}.`,
      message: 'Underpayment detected.',
    };
  }

  const paidAtTimestamp = new Date().toISOString();

  if (supabase) {
    await supabase
      .from('tickets')
      .update({ status: 'PAID', paid_at: paidAtTimestamp })
      .eq('ticket_ref', matchedRef);

    // Also update order and assigned tickets if present
    await supabase
      .from('orders')
      .update({
        status: 'paid',
        verification_status: 'verified',
        paid_at: paidAtTimestamp,
        verified_at: paidAtTimestamp,
        verified_by: 'SMS_AUTO_VERIFIER',
        mtn_transaction_id: telcoTransId || undefined,
      })
      .eq('order_ref', matchedRef);

    await supabase
      .from('tickets')
      .update({
        status: 'issued',
        payment_status: 'paid',
        paid_at: paidAtTimestamp,
        mtn_transaction_id: telcoTransId || undefined,
      })
      .eq('order_ref', matchedRef);
  }

  ticket.status = 'PAID';
  ticket.paid_at = paidAtTimestamp;
  _memoryTickets.set(matchedRef, ticket);

  // Asynchronously dispatch QR code email
  setImmediate(() => {
    approveAndSendTicket(matchedRef);
  });

  return {
    success: true,
    matched: true,
    ticketRef: matchedRef,
    status: 'PAID',
    telcoTransId,
    message: `Payment confirmed for ${matchedRef}. QR ticket dispatched.`,
  };
}
