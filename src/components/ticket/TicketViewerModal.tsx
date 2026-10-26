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

  const shareWhatsApp = () => {
    const text = encodeURIComponent(
      `Your Pool Party 2026 Ticket is ready! 🎉\n\nTicket: ${ticket.ticket_number} (${ticket.category} Pass)\nGuest: ${ticket.buyer_name || 'Guest'}\nVerify Ticket: ${verifyUrl}\n\nVenue: Prince Resort, Bunamwaya (Bella), Uganda\nDate: Friday, 11 December 2026`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const guestName = ticket.buyer_name || 'Unassigned / Available';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-black/90 backdrop-blur-md">
      <div 
        className="relative w-full max-w-4xl bg-[#070e1b] border-2 border-amber-400/50 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
        role="dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#030712] border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <span className={`text-xs font-black uppercase px-2.5 py-1 rounded ${
              ticket.category === 'VIP' ? 'bg-cyan-400 text-slate-950' : 'bg-amber-400 text-slate-950'
            }`}>
              {ticket.category} Pass
            </span>
            <h3 className="text-lg font-bold text-white font-display">
              {ticket.ticket_number} · {guestName}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Ticket Render Preview */}
          <div className="bg-[#02050b] p-4 rounded-xl border border-white/10 flex flex-col items-center justify-center min-h-[220px]">
            {loading ? (
              <div className="flex flex-col items-center gap-2 text-xs text-amber-300 py-10">
                <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
                <span>Rendering Canva Template with Unique QR Code...</span>
              </div>
            ) : canvasUrl ? (
              <div className="w-full flex flex-col items-center">
                <img
                  src={canvasUrl}
                  alt={`Personalized ${ticket.category} Ticket ${ticket.ticket_number}`}
                  className="w-full max-w-3xl h-auto rounded-lg shadow-2xl border border-amber-400/30 object-contain"
                />
                <p className="text-[11px] text-slate-400 mt-2 text-center">
                  Official Canva Pass Overlay · Dynamic QR token: <span className="font-mono text-cyan-300">{ticket.qr_token.substring(0, 13)}...</span>
                </p>
              </div>
            ) : (
              <p className="text-xs text-rose-400">Failed to render ticket canvas.</p>
            )}
          </div>

          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleDownloadPdf}
                disabled={downloadingPdf || loading}
                className="px-4 py-2.5 bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-300 hover:to-amber-200 text-slate-950 text-xs font-black rounded-lg transition-all flex items-center gap-2 shadow-sm uppercase cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{downloadingPdf ? 'Generating PDF...' : 'Download Print-Ready PDF'}</span>
              </button>

              <button
                onClick={handleDownloadPng}
                disabled={loading}
                className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-2 border border-white/10 cursor-pointer"
              >
                <Download className="w-4 h-4 text-cyan-400" />
                <span>Download PNG</span>
              </button>

              <button
                onClick={copyLink}
                className="px-3.5 py-2.5 bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 border border-white/10 cursor-pointer"
              >
                {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                <span>{copiedLink ? 'Copied!' : 'Copy Verify URL'}</span>
              </button>

              <button
                onClick={shareWhatsApp}
                className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Share WhatsApp</span>
              </button>
            </div>

            <div className="text-right text-xs">
              <span className="text-slate-400 block">Status:</span>
              <span className={`font-bold uppercase ${ticket.payment_status === 'paid' || ticket.payment_status === 'manual_paid' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {ticket.status} · {ticket.payment_status}
              </span>
            </div>
          </div>

          {/* Ticket Metadata Breakdown */}
          <div className="bg-[#030712] p-4 rounded-xl border border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Ticket Number</span>
              <span className="font-bold text-white font-mono">{ticket.ticket_number}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Attendee Name</span>
              <span className="font-bold text-white">{guestName}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Contact Phone</span>
              <span className="text-slate-300 font-mono">{ticket.buyer_phone || 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Price</span>
              <span className="font-bold text-amber-300 font-mono">UGX {ticket.price_ugx.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Payment Status</span>
              <span className="text-slate-300 font-bold uppercase">{ticket.payment_status}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase">Check-in Status</span>
              <span className={ticket.checked_in_at ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                {ticket.checked_in_at ? `Used (${new Date(ticket.checked_in_at).toLocaleTimeString()})` : 'Unused (Valid for 1 Entry)'}
              </span>
            </div>
            <div className="sm:col-span-2">
              <span className="text-slate-400 block text-[10px] uppercase">Database QR Token (UUID)</span>
              <span className="text-[11px] font-mono text-cyan-300 truncate block">
                {ticket.qr_token}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#030712] border-t border-white/10 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg uppercase cursor-pointer"
          >
            Close Viewer
          </button>
        </div>
      </div>
    </div>
  );
};
