import React, { useState, useEffect } from 'react';
import { 
  X, 
  MessageCircle, 
  ExternalLink, 
  Copy, 
  Check, 
  Download, 
  Printer, 
  Share2, 
  CheckCircle2, 
  AlertCircle,
  Smartphone,
  QrCode,
  Info
} from 'lucide-react';
import { TicketRecord } from '../../types/inventory';
import { TicketRenderer } from '../../lib/ticketRenderer';
import { WhatsAppService, WhatsAppPhoneResult } from '../../lib/whatsappService';

interface WhatsAppDeliveryModalProps {
  order: any;
  tickets: TicketRecord[];
  onClose: () => void;
  isNewlyVerified?: boolean;
}

export const WhatsAppDeliveryModal: React.FC<WhatsAppDeliveryModalProps> = ({
  order,
  tickets,
  onClose,
  isNewlyVerified = false,
}) => {
  const [selectedPhone, setSelectedPhone] = useState<string>('');
  const [phoneInfo, setPhoneInfo] = useState<WhatsAppPhoneResult>({
    internationalDigits: '',
    displayPhone: '',
    valid: false,
    raw: '',
  });
  const [message, setMessage] = useState<string>('');
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [downloadingTicketId, setDownloadingTicketId] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Initialize phone number
  useEffect(() => {
    const raw = order.buyer_phone || order.payer_phone || '';
    setSelectedPhone(raw);
    const formatted = WhatsAppService.formatPhoneForWhatsApp(raw);
    setPhoneInfo(formatted);

    const msg = WhatsAppService.buildTicketMessage({
      buyerName: order.buyer_name || 'Valued Guest',
      category: order.category,
      quantity: order.quantity || tickets.length || 1,
      totalAmountUgx: order.total_amount_ugx || (order.category === 'VIP' ? 50000 : 20000),
      orderRef: order.order_ref,
      tickets: tickets.map((t) => ({
        ticket_number: t.ticket_number,
        qr_token: t.qr_token,
      })),
      origin: typeof window !== 'undefined' ? window.location.origin : undefined,
    });
    setMessage(msg);
  }, [order, tickets]);

  const handlePhoneChange = (newPhone: string) => {
    setSelectedPhone(newPhone);
    const formatted = WhatsAppService.formatPhoneForWhatsApp(newPhone);
    setPhoneInfo(formatted);
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(message);
    setCopiedMessage(true);
    setTimeout(() => setCopiedMessage(false), 2000);
  };

  const handleOpenWhatsApp = () => {
    const url = WhatsAppService.generateWhatsAppUrl(selectedPhone, message);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleShareFile = async (ticket: TicketRecord) => {
    setIsSharing(true);
    setShareFeedback(null);
    try {
      const res = await WhatsAppService.shareTicketFileViaWebShare(ticket, message);
      if (res.shared) {
        setShareFeedback('Opened system share menu. Select WhatsApp to complete sending.');
      } else if (res.error === 'USER_CANCELLED') {
        // User dismissed sheet
      } else {
        // Fallback to opening WhatsApp link
        handleOpenWhatsApp();
      }
    } catch {
      handleOpenWhatsApp();
    } finally {
      setIsSharing(false);
    }
  };

  const handleDownloadPng = async (ticket: TicketRecord) => {
    setDownloadingTicketId(ticket.id);
    try {
      await TicketRenderer.downloadTicketImage(ticket);
    } catch (err) {
      console.error('Error downloading ticket image:', err);
    } finally {
      setDownloadingTicketId(null);
    }
  };

  const handleDownloadPdf = async (ticket: TicketRecord) => {
    setDownloadingTicketId(ticket.id);
    try {
      await TicketRenderer.downloadTicketPdf(ticket);
    } catch (err) {
      console.error('Error downloading ticket PDF:', err);
    } finally {
      setDownloadingTicketId(null);
    }
  };

  const handleDownloadAllPdf = async () => {
    if (tickets.length === 0) return;
    setDownloadingPdf(true);
    try {
      await TicketRenderer.downloadAllTicketsPdf(tickets);
    } catch (err) {
      console.error('Error downloading all tickets PDF:', err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const canShare = typeof window !== 'undefined' && WhatsAppService.canShareFiles();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm overflow-y-auto">
      <div className="bg-[#0b1220] border-2 border-emerald-500/60 rounded-2xl max-w-2xl w-full p-4 sm:p-6 space-y-4 shadow-2xl my-auto max-h-[94vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#25D366]/20 border border-[#25D366]/50 flex items-center justify-center text-[#25D366] shrink-0">
              <MessageCircle className="w-5 h-5 fill-current" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-white font-display flex items-center gap-2">
                <span>Send Ticket on WhatsApp</span>
              </h3>
              <p className="text-xs text-slate-400">
                Official Pool Party pass delivery · Order #{order.order_ref}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Verification Success Callout (If newly verified) */}
        {isNewlyVerified && (
          <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/50 text-emerald-200 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold text-white block mb-0.5">
                Payment Verified & Passes Activated!
              </strong>
              <p className="text-emerald-200/90 leading-relaxed">
                The payment is confirmed, {tickets.length} ticket QR code(s) have been generated, and the order is marked as paid. You can now deliver the official ticket directly to the customer on WhatsApp.
              </p>
            </div>
          </div>
        )}

        {/* Phone Number Selector / Input */}
        <div className="bg-[#030712] rounded-xl border border-white/10 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span>Customer WhatsApp Phone Number</span>
            </label>
            {phoneInfo.valid ? (
              <span className="text-[11px] font-mono text-emerald-400 font-semibold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                <span>Valid: {phoneInfo.displayPhone}</span>
              </span>
            ) : (
              <span className="text-[11px] text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Enter 10-digit Uganda number (07... or 256...)</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="tel"
              value={selectedPhone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="e.g. 0775 198 484 or +256 775 198484"
              className="flex-1 px-3.5 py-2.5 bg-[#080c14] border border-white/15 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-emerald-400"
            />
            {order.payer_phone && order.payer_phone !== order.buyer_phone && (
              <button
                type="button"
                onClick={() => handlePhoneChange(order.payer_phone)}
                className="px-2.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs text-slate-300 font-mono cursor-pointer shrink-0"
                title="Use MTN MoMo Payer Phone Number"
              >
                Use Payer Phone
              </button>
            )}
          </div>
        </div>

        {/* Prepared WhatsApp Message Preview */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Prepared WhatsApp Message
            </label>
            <button
              type="button"
              onClick={handleCopyMessage}
              className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
            >
              {copiedMessage ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedMessage ? 'Copied to Clipboard' : 'Copy Message Text'}</span>
            </button>
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={7}
            className="w-full px-3.5 py-2.5 bg-[#030712] border border-white/15 rounded-xl text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-emerald-400"
          />
        </div>

        {/* Issued Tickets & Download Options */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <QrCode className="w-4 h-4 text-cyan-400" />
              <span>Official Activated Passes ({tickets.length})</span>
            </span>

            {tickets.length > 1 && (
              <button
                type="button"
                onClick={handleDownloadAllPdf}
                disabled={downloadingPdf}
                className="px-2.5 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{downloadingPdf ? 'Generating...' : `Download All ${tickets.length} (PDF)`}</span>
              </button>
            )}
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {tickets.map((t, idx) => (
              <div
                key={t.id}
                className="bg-[#030712] border border-white/10 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-amber-300 text-sm">
                      #{t.ticket_number}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                      t.category === 'VIP' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                    }`}>
                      {t.category}
                    </span>
                    <span className="text-[11px] text-slate-400 truncate">
                      {t.buyer_name}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono truncate block mt-0.5">
                    QR Gate Token: {t.qr_token.substring(0, 16)}...
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDownloadPng(t)}
                    disabled={downloadingTicketId === t.id}
                    className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/15 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer min-h-[34px]"
                    title="Download ticket as PNG image to attach on WhatsApp"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400" />
                    <span>PNG</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(t)}
                    disabled={downloadingTicketId === t.id}
                    className="px-2.5 py-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer min-h-[34px]"
                    title="Download print-ready PDF ticket"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>PDF</span>
                  </button>

                  {canShare && (
                    <button
                      type="button"
                      onClick={() => handleShareFile(t)}
                      disabled={isSharing}
                      className="px-2.5 py-1.5 bg-[#25D366]/20 hover:bg-[#25D366]/30 border border-[#25D366]/50 text-[#25D366] text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer min-h-[34px]"
                      title="Share ticket image directly to WhatsApp"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Share</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Important Usage Note */}
        <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 text-[11px] space-y-1">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
            <Info className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>How WhatsApp Delivery Works</span>
          </div>
          <p className="leading-relaxed">
            Clicking <strong>Open WhatsApp to Send</strong> will launch WhatsApp with this pre-filled message and every ticket's secure entrance QR code. You can download the Canva flyer ticket (PNG or PDF) using the buttons above and attach it to the chat before hitting Send.
          </p>
        </div>

        {shareFeedback && (
          <div className="p-2.5 rounded-lg bg-cyan-950/60 border border-cyan-600/50 text-cyan-300 text-xs">
            {shareFeedback}
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white cursor-pointer"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleOpenWhatsApp}
            disabled={!phoneInfo.valid}
            className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 bg-[#25D366] hover:bg-[#20ba59] disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer flex items-center justify-center gap-2 shadow-lg transition-all"
          >
            <MessageCircle className="w-4 h-4 fill-current" />
            <span>Open WhatsApp to Send</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

      </div>
    </div>
  );
};
