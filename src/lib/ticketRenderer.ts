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
    const verificationUrl = `${window.location.origin}?verify=${ticket.qr_token}`;
    const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 400,
      color: {
        dark: '#030712',
        light: '#ffffff',
      },
    });

    // 2. Load background template image (handles both root and public paths)
    const bgImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        // Try fallback URL if primary fails
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

    // 4. Create and configure high-DPI canvas
    const canvas = document.createElement('canvas');
    const width = bgImage.naturalWidth || 1000;
    const height = bgImage.naturalHeight || 333;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context');

    // Draw background Canva template
    ctx.drawImage(bgImage, 0, 0, width, height);

    const guestName = ticket.buyer_name || 'Guest Pass Holder';

    if (isVip) {
      // VIP Template Layout (2_c9323f09.jpg):
      // QR White square is at the top right stub
      const qrX = width * 0.812;
      const qrY = height * 0.125;
      const qrW = width * 0.146;
      const qrH = height * 0.455;

      // Draw QR into white placeholder box
      ctx.drawImage(qrImage, qrX, qrY, qrW, qrH);

      // Mask and overlay dynamic Ticket ID & Guest Name in bottom right box
      const textX = width * 0.805;
      
      // Clean background for Ticket ID
      ctx.fillStyle = '#06101d';
      ctx.fillRect(textX + width * 0.058, height * 0.73, width * 0.13, height * 0.08);
      // Clean background for Guest Name
      ctx.fillRect(textX + width * 0.075, height * 0.815, width * 0.115, height * 0.08);

      // Render actual dynamic text (e.g. VIP-001)
      ctx.font = `bold ${Math.round(height * 0.048)}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(ticket.ticket_number, textX + width * 0.06, height * 0.79);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(
        guestName.length > 18 ? guestName.substring(0, 16) + '...' : guestName,
        textX + width * 0.075,
        height * 0.875
      );
    } else {
      // Ordinary Template Layout (1_d9ab832d.jpg):
      // QR White square is in the middle of the stub
      const qrX = width * 0.668;
      const qrY = height * 0.465;
      const qrW = width * 0.131;
      const qrH = height * 0.395;

      // Draw QR into white placeholder box
      ctx.drawImage(qrImage, qrX, qrY, qrW, qrH);

      // Clean background for Ticket ID on right side of QR box
      const infoBoxX = width * 0.825;
      ctx.fillStyle = '#07101b';
      ctx.fillRect(infoBoxX + width * 0.055, height * 0.525, width * 0.11, height * 0.075);
      // Clean background for Guest Name
      ctx.fillRect(infoBoxX + width * 0.075, height * 0.665, width * 0.09, height * 0.075);

      // Render actual dynamic text (e.g. ORD-001)
      ctx.font = `bold ${Math.round(height * 0.044)}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(ticket.ticket_number, infoBoxX + width * 0.058, height * 0.585);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(
        guestName.length > 16 ? guestName.substring(0, 14) + '...' : guestName,
        infoBoxX + width * 0.078,
        height * 0.725
      );
    }

    return canvas;
  },

  /**
   * Generates a downloadable personalized print-ready PDF
   */
  async generatePdfTicket(ticket: TicketRecord): Promise<void> {
    const canvas = await this.renderTicketToCanvas(ticket);
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    // Standard landscape ticket size (210mm x 70mm, 3:1 ratio matching the Canva poster design)
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [210, 70],
    });

    pdf.addImage(imgData, 'JPEG', 0, 0, 210, 70);
    pdf.save(`Pool_Party_2026_${ticket.category}_${ticket.ticket_number}.pdf`);
  },

  /**
   * Download image directly as PNG
   */
  async downloadTicketImage(ticket: TicketRecord): Promise<void> {
    const canvas = await this.renderTicketToCanvas(ticket);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `Pool_Party_${ticket.category}_${ticket.ticket_number}.png`;
    a.click();
  },
};
