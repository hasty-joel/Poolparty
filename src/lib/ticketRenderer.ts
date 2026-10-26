import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { TicketRecord } from '../types/inventory';

const TICKET_TEMPLATES = {
  ordinary: '/assets/aistudio/1_d9ab832d.jpg',
  vip: '/assets/aistudio/2_c9323f09.jpg',
};

export const TicketRenderer = {
  /**
   * Generates a high-resolution Canvas composite with Canva template + dynamic QR & Attendee data
   */
  async renderTicketToCanvas(ticket: TicketRecord): Promise<HTMLCanvasElement> {
    const isVip = ticket.category === 'VIP';
    const primaryUrl = isVip ? TICKET_TEMPLATES.vip : TICKET_TEMPLATES.ordinary;
    const fallbackUrl = isVip ? '/public/assets/aistudio/2_c9323f09.jpg' : '/public/assets/aistudio/1_d9ab832d.jpg';

    // 1. Generate QR Code using the secure unguessable qr_token UUID
    // The gate scanner verifies ?verify=<qr_token>
    const verificationUrl = `${window.location.origin}?verify=${encodeURIComponent(ticket.qr_token)}`;
    const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 500,
      color: {
        dark: '#050b14',
        light: '#ffffff',
      },
    });

    // 2. Load background template image (handles both root and public paths)
    const bgImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        const fallback = new Image();
        fallback.crossOrigin = 'anonymous';
        fallback.onload = () => resolve(fallback);
        fallback.onerror = () => reject(new Error('Failed to load ticket template image'));
        fallback.src = fallbackUrl;
      };
      img.src = primaryUrl;
    });

    // 3. Load QR code image
    const qrImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load generated QR image'));
      img.src = qrDataUrl;
    });

    // 4. Create canvas at native template resolution (2000 x 647)
    const canvas = document.createElement('canvas');
    const width = bgImage.naturalWidth || 2000;
    const height = bgImage.naturalHeight || 647;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context');

    // Draw pristine background Canva template
    ctx.drawImage(bgImage, 0, 0, width, height);

    const guestName = (ticket.buyer_name || 'Guest Pass Holder').trim();

    if (isVip) {
      // ========================================================
      // VIP Template Layout (2_c9323f09.jpg - 2000 x 647)
      // ========================================================

      // 1. White QR placeholder box is at the top right of the stub
      // x: ~1624 (81.2%), y: ~77 (11.9%), w: ~292 (14.6%), h: ~305 (47.1%)
      const qrX = width * 0.812;
      const qrY = height * 0.119;
      const qrW = width * 0.146;
      const qrH = height * 0.471;
      const qrPadding = 8;

      ctx.drawImage(
        qrImage,
        qrX + qrPadding,
        qrY + qrPadding,
        qrW - qrPadding * 2,
        qrH - qrPadding * 2
      );

      // 2. Overlay Ticket ID in the designated section below "SCAN FOR ENTRY"
      // Mask the "[UNIQUE TICKET ID]" placeholder cleanly with the dark stub background
      ctx.fillStyle = '#040a16';
      ctx.fillRect(width * 0.875, height * 0.745, width * 0.105, height * 0.055);

      // Render actual dynamic Ticket ID (e.g. VIP-001)
      ctx.font = `bold ${Math.round(height * 0.042)}px "Outfit", "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = '#00e5ff';
      ctx.textBaseline = 'middle';
      ctx.fillText(ticket.ticket_number, width * 0.876, height * 0.772);

      // 3. Overlay Guest Name
      // Mask the "[GUEST NAME]" placeholder
      ctx.fillStyle = '#040a16';
      ctx.fillRect(width * 0.880, height * 0.825, width * 0.102, height * 0.055);

      // Render actual Attendee Name
      ctx.font = `600 ${Math.round(height * 0.038)}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      const truncatedVipName = guestName.length > 18 ? guestName.substring(0, 16) + '...' : guestName;
      ctx.fillText(truncatedVipName, width * 0.881, height * 0.852);

    } else {
      // ========================================================
      // Ordinary Template Layout (1_d9ab832d.jpg - 2000 x 647)
      // ========================================================

      // 1. White QR placeholder box is at bottom left of the stub
      // x: ~1335 (66.75%), y: ~300 (46.3%), w: ~265 (13.25%), h: ~255 (39.4%)
      const qrX = width * 0.6675;
      const qrY = height * 0.463;
      const qrW = width * 0.1325;
      const qrH = height * 0.394;
      const qrPadding = 6;

      ctx.drawImage(
        qrImage,
        qrX + qrPadding,
        qrY + qrPadding,
        qrW - qrPadding * 2,
        qrH - qrPadding * 2
      );

      // 2. Info box is to the right of the QR code
      // Mask the "[UNIQUE TICKET ID]" placeholder inside the rounded card
      ctx.fillStyle = '#07101b';
      ctx.fillRect(width * 0.860, height * 0.525, width * 0.115, height * 0.065);

      // Render actual dynamic Ticket ID (e.g. ORD-001)
      ctx.font = `bold ${Math.round(height * 0.040)}px "Outfit", "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = '#38bdf8';
      ctx.textBaseline = 'middle';
      ctx.fillText(ticket.ticket_number, width * 0.862, height * 0.558);

      // 3. Mask the "[GUEST NAME]" placeholder inside the rounded card
      ctx.fillStyle = '#07101b';
      ctx.fillRect(width * 0.860, height * 0.675, width * 0.115, height * 0.065);

      // Render actual Attendee Name
      ctx.font = `600 ${Math.round(height * 0.036)}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      const truncatedOrdName = guestName.length > 17 ? guestName.substring(0, 15) + '...' : guestName;
      ctx.fillText(truncatedOrdName, width * 0.862, height * 0.708);
    }

    return canvas;
  },

  /**
   * Generates a downloadable personalized print-ready PDF (Single Ticket)
   */
  async generatePdfTicket(ticket: TicketRecord): Promise<void> {
    const canvas = await this.renderTicketToCanvas(ticket);
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    // Standard landscape voucher ticket size: 210mm x 68mm (~3.09:1 ratio matching the 2000x647 artwork)
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [210, 68],
    });

    pdf.addImage(imgData, 'JPEG', 0, 0, 210, 68);
    pdf.save(`Pool_Party_2026_${ticket.category}_${ticket.ticket_number}.pdf`);
  },

  /**
   * Generates a single multi-page PDF containing all purchased tickets
   */
  async downloadAllTicketsPdf(tickets: TicketRecord[]): Promise<void> {
    if (tickets.length === 0) return;

    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [210, 68],
    });

    for (let i = 0; i < tickets.length; i++) {
      if (i > 0) {
        pdf.addPage([210, 68], 'landscape');
      }
      const canvas = await this.renderTicketToCanvas(tickets[i]);
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', 0, 0, 210, 68);
    }

    pdf.save(`Pool_Party_2026_All_${tickets.length}_Tickets.pdf`);
  },

  /**
   * Download ticket directly as high-resolution PNG
   */
  async downloadTicketImage(ticket: TicketRecord): Promise<void> {
    const canvas = await this.renderTicketToCanvas(ticket);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `Pool_Party_${ticket.category}_${ticket.ticket_number}.png`;
    a.click();
  },
};
