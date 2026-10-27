import React, { useState, useEffect } from 'react';
import { X, Download, Copy, Check, Share2, RefreshCw } from 'lucide-react';
import { TicketRecord } from '../../types/inventory';
import { TicketRenderer } from '../../lib/ticketRenderer';

interface TicketViewerModalProps {
  ticket: TicketRecord | null;
  onClose: () => void;
}

export const TicketViewerModal: React.FC<TicketViewerModalProps> = ({ ticket, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!ticket) return;

    let isMounted = true;
    setLoading(true);

    TicketRenderer.renderTicketToCanvas(ticket)
      .then((canvas) => {
        if (isMounted) {
          setCanvasUrl(canvas.toDataURL('image/png'));
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error rendering ticket:', err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [ticket]);

  if (!ticket) return null;

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      await TicketRenderer.generatePdfTicket(ticket);
    } catch (err) {
      console.error('PDF error', err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadPng = async () => {
    try {
      await TicketRenderer.downloadTicketImage(ticket);
    } catch (err) {
      console.error('PNG error', err);
    }
  };

  const verifyUrl = `${window.location.origin}?verify=${ticket.qr_token}`;

  const copyLink = () => {
    navigator.clipboard.writeText(verifyUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const whatsAppShareHref = `https://wa.me/?text=${encodeURIComponent(
    `Pool Party 2026 Ticket\n\nPass: #${ticket.ticket_number} (${ticket.category} Pass)\nGuest: ${ticket.buyer_name || 'Guest'}\nVerify Ticket: ${verifyUrl}\n\nVenue: Prince Resort, Bunamwaya (Bella), Uganda\nDate: Friday, 11 December 2026`
  )}`;

  const guestName = ticket.buyer_name || 'Unassigned / Available';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 xs:p-3 sm:p-6 overflow-y-auto bg-black/85 backdrop-blur-sm">
      <div 
        className="relative w-full max-w-4xl bg-[#0d1522] border border-white/15 rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[94vh]"
        role="dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 sm:px-6 py-3 sm:py-4 bg-[#080c14] border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 ${
              ticket.category === 'VIP' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-slate-800 text-slate-200'
            }`}>
              {ticket.category} Pass
            </span>
            <h3 className="text-sm sm:text-base font-bold text-white font-display truncate">
              {ticket.ticket_number} · {guestName}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto max-h-[calc(94vh-65px)]">
          {/* Ticket Render Preview */}
          <div className="bg-[#080c14] p-2.5 sm:p-4 rounded-xl border border-white/10 flex flex-col items-center justify-center min-h-[180px]">
            {loading ? (
              <div className="flex flex-col items-center gap-2 text-xs text-amber-300 py-8">
                <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
                <span>Rendering Canva pass overlay...</span>
              </div>
            ) : canvasUrl ? (
              <div className="w-full flex flex-col items-center">
                <img
                  src={canvasUrl}
                  alt={`Personalized ${ticket.category} Ticket ${ticket.ticket_number}`}
                  className="w-full max-w-3xl h-auto rounded-lg shadow-lg border border-white/15 object-contain"
                />
                <p className="text-[10px] sm:text-[11px] text-slate-400 mt-2 text-center">
                  Official Canva Artwork with Cryptographic QR Token
                </p>
              </div>
            ) : (
              <p className="text-xs text-rose-400">Failed to render ticket canvas.</p>
            )}
          </div>

          {/* Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-white/10">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2 w-full sm:w-auto">
              <button
                onClick={handleDownloadPdf}
                disabled={downloadingPdf || loading}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm uppercase cursor-pointer"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>{downloadingPdf ? 'Generating PDF...' : 'Download Print PDF'}</span>
              </button>

              <button
                onClick={handleDownloadPng}
                disabled={loading}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 border border-slate-700 cursor-pointer"
              >
                <Download className="w-4 h-4 text-slate-400 shrink-0" />
                <span>Download PNG</span>
              </button>

              <button
                onClick={copyLink}
                className="w-full sm:w-auto min-h-[44px] px-3.5 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 border border-white/10 cursor-pointer"
              >
                {copiedLink ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <Copy className="w-4 h-4 text-slate-400 shrink-0" />}
                <span>{copiedLink ? 'Copied' : 'Copy Verify URL'}</span>
              </button>

              <a
                href={whatsAppShareHref}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto min-h-[44px] px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Share2 className="w-4 h-4 shrink-0" />
                <span>Share WhatsApp</span>
              </a>
            </div>

            <div className="text-left sm:text-right text-xs pt-1 sm:pt-0">
              <span className="text-slate-400 block text-[10px] uppercase">Payment Status</span>
              <span className={`font-semibold uppercase ${ticket.payment_status === 'paid' || ticket.payment_status === 'manual_paid' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {ticket.payment_status}
              </span>
            </div>
          </div>

          {/* Ticket Metadata Breakdown */}
          <div className="bg-[#080c14] p-4 rounded-xl border border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Ticket Number</span>
              <span className="font-bold text-white font-mono">{ticket.ticket_number}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Attendee Name</span>
              <span className="font-semibold text-white">{guestName}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Phone</span>
              <span className="text-slate-300 font-mono">{ticket.buyer_phone || 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Price</span>
              <span className="font-semibold text-amber-300 font-mono">UGX {ticket.price_ugx.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Gate Check-in</span>
              <span className={ticket.checked_in_at ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                {ticket.checked_in_at ? `Admitted (${new Date(ticket.checked_in_at).toLocaleTimeString()})` : 'Valid for 1 Entry'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Event Date</span>
              <span className="text-slate-300">Fri, 11 Dec 2026</span>
            </div>
            <div className="sm:col-span-2">
              <span className="text-slate-400 block text-[10px] uppercase">Unique Gate Token (UUID)</span>
              <span className="text-[11px] font-mono text-cyan-300 truncate block">
                {ticket.qr_token}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#080c14] border-t border-white/10 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg uppercase cursor-pointer"
          >
            Close Viewer
          </button>
        </div>
      </div>
    </div>
  );
};
