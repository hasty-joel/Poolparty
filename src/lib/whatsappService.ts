import { TicketRecord } from '../types/inventory';
import { TicketRenderer } from './ticketRenderer';

export interface WhatsAppPhoneResult {
  internationalDigits: string; // e.g. "256775198484" (for wa.me URL)
  displayPhone: string;        // e.g. "+256 775 198 484"
  valid: boolean;
  raw: string;
}

export interface WhatsAppTicketMessageParams {
  buyerName: string;
  category: 'VIP' | 'ORDINARY' | string;
  quantity: number;
  totalAmountUgx: number;
  orderRef: string;
  tickets?: Array<{ ticket_number: string; qr_token: string }>;
  origin?: string;
}

export const WhatsAppService = {
  /**
   * Formats Ugandan and international phone numbers for WhatsApp click-to-chat.
   * WhatsApp wa.me requires strictly digits with the country code (no +, spaces, or dashes).
   */
  formatPhoneForWhatsApp(rawPhone: string): WhatsAppPhoneResult {
    if (!rawPhone || typeof rawPhone !== 'string') {
      return { internationalDigits: '', displayPhone: '', valid: false, raw: '' };
    }

    // Remove all non-digits except leading plus for detection
    let digits = rawPhone.replace(/\D/g, '');

    // Handle Uganda local notation: 077X XXXXXX -> 25677X XXXXXX
    if (digits.startsWith('0') && digits.length === 10) {
      digits = `256${digits.substring(1)}`;
    } else if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('3'))) {
      digits = `256${digits}`;
    }

    // Check if it matches valid Uganda Mobile Money prefix (256 + 9 digits starting with 7 or 3)
    const isUganda = /^256[73]\d{8}$/.test(digits);
    const valid = isUganda || digits.length >= 10;

    let displayPhone = `+${digits}`;
    if (isUganda) {
      // Format as +256 7XX XXX XXX
      displayPhone = `+256 ${digits.substring(3, 6)} ${digits.substring(6, 9)} ${digits.substring(9)}`;
    }

    return {
      internationalDigits: digits,
      displayPhone,
      valid,
      raw: rawPhone,
    };
  },

  /**
   * Prepares the official verified ticket notification message for WhatsApp
   */
  buildTicketMessage(params: WhatsAppTicketMessageParams): string {
    const { buyerName, category, quantity, totalAmountUgx, orderRef, tickets = [], origin } = params;
    const baseUrl = origin || (typeof window !== 'undefined' ? window.location.origin : 'https://poolparty.ug');

    const ticketLines = tickets.map((t) => {
      const verifyLink = `${baseUrl}?verify=${encodeURIComponent(t.qr_token)}`;
      return `🎫 Pass #${t.ticket_number}:\n${verifyLink}`;
    });

    const ticketListSection = ticketLines.length > 0
      ? `\n\n${ticketLines.join('\n\n')}`
      : `\n\n🧾 Order Verification Link:\n${baseUrl}/#ticket-${encodeURIComponent(orderRef)}`;

    return `Hello ${buyerName.trim()}! 🎉

Your payment for Pool Party has been verified successfully!

🎟️ Ticket: ${category}
🔢 Quantity: ${quantity}
💰 Amount: UGX ${Number(totalAmountUgx).toLocaleString()}
🧾 Order Reference: ${orderRef}

Your ticket and QR code are ready. Present your QR code at the entrance for check-in.${ticketListSection}

Get ready for an amazing Pool Party! 🔥`;
  },

  /**
   * Generates the official WhatsApp click-to-chat URL
   */
  generateWhatsAppUrl(phone: string, message: string): string {
    const phoneInfo = this.formatPhoneForWhatsApp(phone);
    const encodedText = encodeURIComponent(message);
    if (!phoneInfo.internationalDigits) {
      return `https://wa.me/?text=${encodedText}`;
    }
    return `https://wa.me/${phoneInfo.internationalDigits}?text=${encodedText}`;
  },

  /**
   * Checks if the browser supports sharing image files via Web Share API
   */
  canShareFiles(): boolean {
    if (typeof navigator === 'undefined' || !navigator.canShare) return false;
    try {
      const testFile = new File([''], 'test.png', { type: 'image/png' });
      return navigator.canShare({ files: [testFile] });
    } catch {
      return false;
    }
  },

  /**
   * Shares the actual generated ticket PNG file directly into WhatsApp (supported on mobile browsers)
   */
  async shareTicketFileViaWebShare(
    ticket: TicketRecord,
    message: string
  ): Promise<{ shared: boolean; error?: string }> {
    if (!this.canShareFiles()) {
      return { shared: false, error: 'FILE_SHARE_UNSUPPORTED' };
    }

    try {
      const canvas = await TicketRenderer.renderTicketToCanvas(ticket);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png', 0.95)
      );

      if (!blob) {
        return { shared: false, error: 'BLOB_CREATION_FAILED' };
      }

      const file = new File(
        [blob],
        `Pool_Party_2026_${ticket.category}_${ticket.ticket_number}.png`,
        { type: 'image/png' }
      );

      await navigator.share({
        title: `Pool Party 2026 - ${ticket.ticket_number}`,
        text: message,
        files: [file],
      });

      return { shared: true };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { shared: false, error: 'USER_CANCELLED' };
      }
      return { shared: false, error: err?.message || 'SHARE_FAILED' };
    }
  },
};
