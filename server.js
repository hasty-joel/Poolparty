/**
 * ==============================================================================
 * POOL PARTY TICKETING BACKEND SERVER (Node.js & Express)
 * ==============================================================================
 * Event: Pool Party Experience with Trevor DJ
 * Date: Friday, 11 December 2026
 * Venue: Prince Resort, Bunamwaya (Bella), Uganda
 * 
 * Features:
 * 1. POST /api/create-pending-ticket: Generates POOL-XXXX ref and creates PENDING ticket.
 * 2. GET  /api/ticket-status/:ref: Real-time status lookup (PENDING vs PAID) for frontend polling.
 * 3. POST /api/sms-listener: Webhook for Android SMS Forwarder (MTN MoMo & Airtel Money).
 * 4. approveAndSendTicket(ticketRef): QR code buffer generation (qrcode) & inline CID email (nodemailer).
 * ==============================================================================
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import qrcode from 'qrcode';
import nodemailer from 'nodemailer';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON body parsing
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));

// ------------------------------------------------------------------------------
// 1. ENVIRONMENT CONFIGURATION & SUPABASE INITIALIZATION
// ------------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
// Support SUPABASE_KEY or SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn(
    '[CONFIG WARNING] SUPABASE_URL or SUPABASE_KEY missing. Database operations will log to console or require environment variables.'
  );
}

// In-memory fallback map if Supabase credentials are not yet configured in local dev
const memoryTickets = new Map();

// Initialize Supabase Client
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

// ------------------------------------------------------------------------------
// 2. NODEMAILER SMTP TRANSPORTER CONFIGURATION
// ------------------------------------------------------------------------------
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD;
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '465', 10);

const transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: EMAIL_PORT,
  secure: EMAIL_PORT === 465, // true for 465, false for 587
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_APP_PASSWORD,
  },
});

// Verify email connection on startup if credentials exist
if (EMAIL_USER && EMAIL_APP_PASSWORD) {
  transporter.verify((error) => {
    if (error) {
      console.warn('[EMAIL WARNING] SMTP configuration error:', error.message);
    } else {
      console.log('[EMAIL] SMTP transporter ready to deliver tickets to attendees.');
    }
  });
} else {
  console.log('[EMAIL NOTE] EMAIL_USER / EMAIL_APP_PASSWORD not set. Tickets will be logged to console.');
}

// ------------------------------------------------------------------------------
// 3. ASYNC TICKET APPROVAL & EMAIL DISPATCH (QRCode + Nodemailer Inline CID)
// ------------------------------------------------------------------------------

/**
 * Asynchronously generates a high-resolution QR code PNG buffer
 * and emails it as an inline CID attachment to the customer.
 * 
 * @param {string} ticketRef - The unique ticket code, e.g., 'POOL-4921'
 */
async function approveAndSendTicket(ticketRef) {
  try {
    console.log(`[TICKET DELIVERY] Initiating ticket approval & delivery for ${ticketRef}...`);

    let ticket = null;

    if (supabase) {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('ticket_ref', ticketRef)
        .maybeSingle();

      if (error) {
        console.error(`[TICKET DELIVERY ERROR] Error fetching ticket ${ticketRef}:`, error.message);
        return;
      }
      ticket = data;
    } else {
      ticket = memoryTickets.get(ticketRef);
    }

    if (!ticket) {
      console.error(`[TICKET DELIVERY ERROR] Ticket record ${ticketRef} not found in database.`);
      return;
    }

    // 1. Generate High-Resolution QR Code Buffer
    // Encodes the ticket reference and optional cryptographic token
    const qrPayload = ticket.qr_token ? `${ticket.ticket_ref}:${ticket.qr_token}` : ticket.ticket_ref;
    const qrBuffer = await qrcode.toBuffer(qrPayload, {
      type: 'png',
      width: 500,
      margin: 2,
      color: {
        dark: '#080C14', // Obsidian dark color matching event theme
        light: '#FFFFFF'
      },
      errorCorrectionLevel: 'H' // High fault tolerance for mobile phone screens
    });

    // 2. Prepare HTML Email with Inline CID Attachment
    const formattedAmount = Number(ticket.amount).toLocaleString();
    const emailSubject = `🎟️ Confirmed: Your Pool Party Pass (${ticket.ticket_ref})`;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #080C14; color: #FFFFFF; margin: 0; padding: 20px; }
          .container { max-width: 560px; margin: 0 auto; background-color: #0F172A; border-radius: 16px; border: 1px solid #1E293B; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .header { background: linear-gradient(135deg, #FFCC00 0%, #D97706 100%); padding: 32px 24px; text-align: center; color: #080C14; }
          .header h1 { margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }
          .header p { margin: 6px 0 0; font-size: 15px; font-weight: 700; opacity: 0.95; }
          .content { padding: 32px 24px; }
          .greeting { font-size: 20px; font-weight: 700; color: #F8FAFC; margin-bottom: 12px; }
          .message { color: #CBD5E1; font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
          .details-card { background-color: #1E293B; border-radius: 12px; padding: 20px; margin-bottom: 28px; border-left: 4px solid #FFCC00; }
          .detail-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
          .detail-label { color: #94A3B8; }
          .detail-value { font-weight: 600; color: #F8FAFC; }
          .qr-box { background-color: #FFFFFF; border-radius: 16px; padding: 24px; text-align: center; margin: 24px 0; }
          .qr-img { width: 260px; height: 260px; display: block; margin: 0 auto; }
          .qr-caption { color: #080C14; font-size: 13px; font-weight: 700; margin-top: 12px; letter-spacing: 0.5px; }
          .notice { font-size: 13px; color: #94A3B8; text-align: center; line-height: 1.5; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #64748B; border-top: 1px solid #1E293B; background-color: #0B1120; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>POOL PARTY 2026</h1>
            <p>Official Admission Pass &bull; Prince Resort Bunamwaya</p>
          </div>
          <div class="content">
            <div class="greeting">Hello, ${ticket.customer_name}!</div>
            <div class="message">
              Your Mobile Money payment has been confirmed. Below is your official entry ticket and gate access QR code.
            </div>

            <div class="details-card">
              <div class="detail-row">
                <span class="detail-label">Ticket Reference:</span>
                <span class="detail-value" style="color: #FFCC00; font-family: monospace; font-size: 16px;">${ticket.ticket_ref}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Amount Paid:</span>
                <span class="detail-value">UGX ${formattedAmount}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Event Date:</span>
                <span class="detail-value">Friday, 11 December 2026 (12 PM &ndash; Till Late)</span>
              </div>
              <div class="detail-row" style="margin-bottom: 0;">
                <span class="detail-label">Venue:</span>
                <span class="detail-value">Prince Resort, Bunamwaya (Bella), Uganda</span>
              </div>
            </div>

            <!-- QR Code Box: Rendered via Inline CID Attachment -->
            <div class="qr-box">
              <img src="cid:ticket_qrcode" alt="Entry QR Code" class="qr-img" />
              <div class="qr-caption">VALID FOR SINGLE ENTRY AT GATE</div>
            </div>

            <div class="notice">
              Please present this email on your phone at Prince Resort security gate. Each QR code is cryptographically unique and will be marked as used upon initial entry.
            </div>
          </div>
          <div class="footer">
            &copy; 2026 Pool Party Experience with Trevor DJ &bull; Bunamwaya Bella, Uganda
          </div>
        </div>
      </body>
      </html>
    `;

    // 3. Dispatch Email via Nodemailer
    if (EMAIL_USER && EMAIL_APP_PASSWORD) {
      const info = await transporter.sendMail({
        from: `"Pool Party Bunamwaya" <${EMAIL_USER}>`,
        to: ticket.customer_email,
        subject: emailSubject,
        html: emailHtml,
        attachments: [
          {
            filename: `Ticket-${ticket.ticket_ref}.png`,
            content: qrBuffer,
            cid: 'ticket_qrcode', // Exactly matches <img src="cid:ticket_qrcode">
            contentType: 'image/png'
          }
        ]
      });
      console.log(`[TICKET DELIVERY SUCCESS] Email dispatched to ${ticket.customer_email} (Message ID: ${info.messageId})`);
    } else {
      console.log(`[TICKET DELIVERY SIMULATED] Pass ${ticket.ticket_ref} approved for ${ticket.customer_email} (UGX ${formattedAmount}).`);
    }
  } catch (err) {
    console.error(`[TICKET DELIVERY EXCEPTION] Failed to deliver ticket ${ticketRef}:`, err);
  }
}

// ------------------------------------------------------------------------------
// 4. API ENDPOINTS
// ------------------------------------------------------------------------------

/**
 * Helper: Generates a unique 4-digit ticket reference code: POOL-XXXX
 */
async function generateUniqueTicketRef() {
  for (let attempt = 0; attempt < 15; attempt++) {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const candidateRef = `POOL-${randomDigits}`;

    if (supabase) {
      const { data, error } = await supabase
        .from('tickets')
        .select('id')
        .eq('ticket_ref', candidateRef)
        .maybeSingle();

      if (error) {
        console.error('[DB ERROR] Uniqueness check failed:', error.message);
        throw new Error('Database lookup failure during reference generation');
      }

      if (!data) return candidateRef;
    } else {
      if (!memoryTickets.has(candidateRef)) return candidateRef;
    }
  }
  throw new Error('Could not generate a unique ticket reference. Please try again.');
}

/**
 * ------------------------------------------------------------------------------
 * ENDPOINT 1: POST /api/create-pending-ticket
 * ------------------------------------------------------------------------------
 * Accepts customer details and creates a PENDING ticket with a unique POOL-XXXX code.
 * Body: { name, email, phone, amount }
 * Returns: { success: true, ticketRef }
 */
app.post('/api/create-pending-ticket', async (req, res) => {
  try {
    const { name, email, phone, amount } = req.body || {};

    // Validate presence of all mandatory fields
    if (!name || !email || !phone || amount === undefined || amount === null) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, email, phone, and amount are mandatory.'
      });
    }

    const parsedAmount = parseInt(amount, 10);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive integer in UGX.'
      });
    }

    // Generate unique 4-digit reference code (e.g., POOL-4921)
    const ticketRef = await generateUniqueTicketRef();

    const newTicketData = {
      ticket_ref: ticketRef,
      customer_name: String(name).trim(),
      customer_email: String(email).trim().toLowerCase(),
      customer_phone: String(phone).trim(),
      amount: parsedAmount,
      status: 'PENDING',
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase
        .from('tickets')
        .insert([newTicketData])
        .select('ticket_ref, status, amount, created_at')
        .single();

      if (error) {
        console.error('[DB INSERT ERROR] Failed to create pending ticket in Supabase:', error.message);
        return res.status(500).json({
          success: false,
          error: 'Failed to record pending ticket in database.'
        });
      }

      console.log(`[TICKET CREATED] Ref: ${data.ticket_ref} | Customer: ${name} | Amount: UGX ${parsedAmount}`);

      return res.status(201).json({
        success: true,
        ticketRef: data.ticket_ref
      });
    } else {
      // Memory fallback for local testing
      memoryTickets.set(ticketRef, newTicketData);
      console.log(`[TICKET CREATED MEMORY] Ref: ${ticketRef} | Customer: ${name} | Amount: UGX ${parsedAmount}`);
      return res.status(201).json({
        success: true,
        ticketRef: ticketRef
      });
    }
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/create-pending-ticket:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error'
    });
  }
});

/**
 * ------------------------------------------------------------------------------
 * ENDPOINT 2: GET /api/ticket-status/:ref
 * ------------------------------------------------------------------------------
 * Queries Supabase for the given ticket_ref and returns its current status (PENDING or PAID).
 * Frontend polls this endpoint while the user completes their Mobile Money transfer.
 */
app.get('/api/ticket-status/:ref', async (req, res) => {
  try {
    const { ref } = req.params;

    if (!ref) {
      return res.status(400).json({
        success: false,
        error: 'Ticket reference parameter is required.'
      });
    }

    const normalizedRef = ref.toUpperCase().trim();

    let ticket = null;

    if (supabase) {
      const { data, error } = await supabase
        .from('tickets')
        .select('ticket_ref, status, customer_name, amount, paid_at')
        .eq('ticket_ref', normalizedRef)
        .maybeSingle();

      if (error) {
        console.error('[DB LOOKUP ERROR] /api/ticket-status/:ref:', error.message);
        return res.status(500).json({
          success: false,
          error: 'Database lookup failed.'
        });
      }

      ticket = data;
    } else {
      ticket = memoryTickets.get(normalizedRef);
    }

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: `No ticket found for reference ${normalizedRef}.`
      });
    }

    return res.status(200).json({
      success: true,
      ticketRef: ticket.ticket_ref,
      status: ticket.status // 'PENDING' or 'PAID'
    });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/ticket-status/:ref:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error checking ticket status'
    });
  }
});

/**
 * ------------------------------------------------------------------------------
 * ENDPOINT 3: POST /api/sms-listener (Android SMS Forwarder Webhook Receiver)
 * ------------------------------------------------------------------------------
 * Acts as a webhook receiver for incoming SMS messages forwarded from an Android
 * SMS forwarder app running on the venue organizer's phone.
 * 
 * ANDROID SMS FORWARDER INTEGRATION SUPPORT & COMMENTS:
 * ---------------------------------------------------
 * Recommended Android Apps (Google Play Store):
 * 1. "SMS Forwarder" by rbsoft
 * 2. "Webhook SMS Forwarder"
 * 3. "Macrodroid" or "Automate"
 * 
 * Expected JSON payload mapped from the Android forwarder:
 * {
 *   "from": "165",                      // Sender address (165 for MTN MoMo, AirtelMoney for Airtel)
 *   "text": "...",                      // Full body of the SMS received on the phone
 *   "timestamp": "2026-12-11T14:32:00Z" // Timestamp when SMS was received
 * }
 * 
 * Flexible fallbacks:
 * - sender field: req.body.from || req.body.sender || req.body.phone
 * - message text: req.body.text || req.body.body || req.body.message || req.body.content
 */
app.post('/api/sms-listener', async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[SMS WEBHOOK RECEIVED] Payload:', JSON.stringify(payload));

    // Extract text and sender from flexible Android forwarder payloads
    const smsText = String(payload.text || payload.body || payload.message || payload.content || '').trim();
    const sender = String(payload.from || payload.sender || payload.phone || '').trim();

    if (!smsText) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payload: sms text body is required.'
      });
    }

    // --------------------------------------------------------------------------
    // REGULAR EXPRESSION PARSING (MTN MoMo & Airtel Money)
    // --------------------------------------------------------------------------
    // 1. Ticket Reference Regex: Matches POOL-XXXX (4 digits)
    // Examples: "Reason: POOL-4921", "Ref: POOL-8832", "POOL-1234"
    const refRegex = /\b(POOL-\d{4})\b/i;
    const refMatch = smsText.match(refRegex);

    if (!refMatch) {
      console.log(`[SMS PARSER IGNORED] No POOL-XXXX reference code found in SMS from ${sender}.`);
      return res.status(200).json({
        success: true,
        matched: false,
        message: 'SMS received, but did not contain a POOL-XXXX ticket reference.'
      });
    }

    const matchedRef = refMatch[1].toUpperCase();

    // 2. Amount Regex: Extracts payment amount in Ugandan Shillings (UGX / Ush)
    // Examples: "UGX 50,000", "UGX. 20000", "Ush 50,000", "UGX50000"
    const amountRegex = /(?:UGX|USH|UGX\.|Shs\.?)\s*([\d,]+)/i;
    const amountMatch = smsText.match(amountRegex);
    const parsedAmount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ''), 10) : null;

    // 3. Telco Transaction ID Regex
    // Examples: "Trans ID: 12345678", "Txn ID: 987654", "Trans.ID: 445566"
    const transIdRegex = /(?:Trans\.?\s*ID|TID|Txn ID|ID|Ref)[\s:]+([A-Za-z0-9]+)/i;
    const transIdMatch = smsText.match(transIdRegex);
    const telcoTransId = transIdMatch ? transIdMatch[1] : null;

    console.log(`[SMS PARSED] Matched Ref: ${matchedRef} | Amount: ${parsedAmount} | Trans ID: ${telcoTransId} | Sender: ${sender}`);

    // --------------------------------------------------------------------------
    // DATABASE LOOKUP & VERIFICATION
    // --------------------------------------------------------------------------
    let ticket = null;

    if (supabase) {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('ticket_ref', matchedRef)
        .maybeSingle();

      if (error) {
        console.error(`[DB ERROR] Fetching ticket ${matchedRef}:`, error.message);
        return res.status(500).json({ success: false, error: 'Database query failed' });
      }
      ticket = data;
    } else {
      ticket = memoryTickets.get(matchedRef);
    }

    if (!ticket) {
      console.warn(`[SMS MISMATCH] Parsed reference ${matchedRef} does not match any record in database.`);
      return res.status(404).json({
        success: false,
        error: `Ticket reference ${matchedRef} not found in database.`
      });
    }

    // If ticket is already marked as PAID, acknowledge without re-sending
    if (ticket.status === 'PAID') {
      console.log(`[SMS DUPLICATE] Ticket ${matchedRef} is already marked as PAID.`);
      return res.status(200).json({
        success: true,
        matched: true,
        alreadyPaid: true,
        ticketRef: matchedRef
      });
    }

    // Underpayment protection: If parsed amount exists and is less than expected amount
    if (parsedAmount && parsedAmount < ticket.amount) {
      console.warn(`[SMS UNDERPAYMENT] Ticket ${matchedRef} expects UGX ${ticket.amount}, received UGX ${parsedAmount}.`);
      return res.status(400).json({
        success: false,
        error: `Underpayment detected: expected UGX ${ticket.amount}, SMS indicated UGX ${parsedAmount}.`
      });
    }

    // --------------------------------------------------------------------------
    // UPDATE STATUS TO 'PAID'
    // --------------------------------------------------------------------------
    const paidAtTimestamp = new Date().toISOString();

    if (supabase) {
      const { error: updateError } = await supabase
        .from('tickets')
        .update({
          status: 'PAID',
          paid_at: paidAtTimestamp
        })
        .eq('ticket_ref', matchedRef);

      if (updateError) {
        console.error(`[DB UPDATE ERROR] Failed to mark ${matchedRef} as PAID:`, updateError.message);
        return res.status(500).json({ success: false, error: 'Database status update failed.' });
      }
    } else {
      ticket.status = 'PAID';
      ticket.paid_at = paidAtTimestamp;
      memoryTickets.set(matchedRef, ticket);
    }

    console.log(`[TICKET CONFIRMED PAID] Ticket ${matchedRef} successfully marked as PAID!`);

    // --------------------------------------------------------------------------
    // ASYNCHRONOUS TICKET QR CODE GENERATION & EMAIL DELIVERY
    // --------------------------------------------------------------------------
    // Invokes approveAndSendTicket asynchronously without blocking HTTP response
    setImmediate(() => {
      approveAndSendTicket(matchedRef);
    });

    return res.status(200).json({
      success: true,
      matched: true,
      ticketRef: matchedRef,
      status: 'PAID',
      telcoTransId: telcoTransId,
      message: `Payment confirmed for ${matchedRef}. QR ticket dispatched via email.`
    });
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/sms-listener:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error processing incoming SMS webhook'
    });
  }
});

// ------------------------------------------------------------------------------
// 5. SERVER STARTUP
// ------------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`Pool Party Backend Server running on port ${PORT}`);
  console.log(`  - POST /api/create-pending-ticket (Creates POOL-XXXX ticket)`);
  console.log(`  - GET  /api/ticket-status/:ref    (Real-time status polling)`);
  console.log(`  - POST /api/sms-listener          (Android SMS Forwarder Webhook)`);
  console.log(`================================================================`);
});

export default app;
