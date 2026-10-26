import React, { useState, useEffect } from 'react';
import { 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  RefreshCw, 
  Download, 
  Share2, 
  Ticket, 
  Smartphone, 
  Copy, 
  Check,
  ChevronLeft,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { TicketService } from '../../lib/ticketService';
import { TicketRenderer } from '../../lib/ticketRenderer';
import { TicketRecord } from '../../types/inventory';
import { OrderStatus } from '../../types/order';

interface RelworxPaymentModalProps {
  orderRef: string | null;
  initialMessage?: string;
  reservedUntil?: string | null;
  totalAmountUgx?: number;
  buyerName?: string;
  buyerPhone?: string;
  network?: 'MTN' | 'AIRTEL';
  onClose: () => void;
  onPaymentSuccess?: () => void;
}

export const RelworxPaymentModal: React.FC<RelworxPaymentModalProps> = ({
  orderRef,
  initialMessage,
  reservedUntil,
  totalAmountUgx,
  buyerName,
  buyerPhone,
  network = 'MTN',
  onClose,
  onPaymentSuccess,
}) => {
  const [status, setStatus] = useState<OrderStatus>('pending');
  const [message, setMessage] = useState<string>(initialMessage || 'Awaiting mobile money authorization on your handset...');
  const [secondsRemaining, setSecondsRemaining] = useState<number>(600); // 10 minutes default
  const [issuedTickets, setIssuedTickets] = useState<TicketRecord[]>([]);
  const [currentTicketIndex, setCurrentTicketIndex] = useState<number>(0);
  const [renderedCanvasUrl, setRenderedCanvasUrl] = useState<string | null>(null);
  const [renderingCanvas, setRenderingCanvas] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [manualChecking, setManualChecking] = useState(false);

  // Countdown timer for 10-minute reservation expiry
  useEffect(() => {
    if (!reservedUntil || status === 'paid' || status === 'failed' || status === 'expired') return;

    const interval = setInterval(() => {
      const now = Date.now();
      const expiry = new Date(reservedUntil).getTime();
      const diffSecs = Math.max(0, Math.floor((expiry - now) / 1000));
      setSecondsRemaining(diffSecs);

      if (diffSecs <= 0) {
        setStatus('expired');
        setMessage('Your 10-minute reservation window has expired. The tickets have returned to stock.');
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [reservedUntil, status]);

  // Polling order status while in 'pending' state
  useEffect(() => {
    if (!orderRef || status !== 'pending') return;

    let isMounted = true;
    let pollCount = 0;

    const check = async () => {
      try {
        const res = await TicketService.checkOrderStatus(orderRef);
        if (!isMounted) return;

        if (res.status === 'paid' && res.tickets && res.tickets.length > 0) {
          setStatus('paid');
          setIssuedTickets(res.tickets);
          if (onPaymentSuccess) onPaymentSuccess();
          return;
        }

        if (res.status === 'expired' || res.status === 'failed' || res.status === 'cancelled') {
          setStatus(res.status);
          if (res.message) setMessage(res.message);
          return;
        }

        if (res.secondsRemaining !== undefined) {
          setSecondsRemaining(res.secondsRemaining);
        }
      } catch (err) {
        console.warn('Polling check error:', err);
      }
    };

    // Immediate check
    check();

    // Poll every 3.5 seconds
    const pollInterval = setInterval(() => {
      pollCount++;
      if (pollCount > 170) {
        clearInterval(pollInterval);
        return;
      }
      check();
    }, 3500);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [orderRef, status, onPaymentSuccess]);

  // Render the current ticket canvas when in 'paid' state
  const activeTicket = issuedTickets[currentTicketIndex] || null;

  useEffect(() => {
    if (!activeTicket) return;

    let isMounted = true;
    setRenderingCanvas(true);

    TicketRenderer.renderTicketToCanvas(activeTicket)
      .then((canvas) => {
        if (isMounted) {
          setRenderedCanvasUrl(canvas.toDataURL('image/png'));
          setRenderingCanvas(false);
        }
      })
      .catch((err) => {
        console.error('Ticket rendering error:', err);
        if (isMounted) setRenderingCanvas(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeTicket]);

  if (!orderRef) return null;

  const handleManualCheck = async () => {
    setManualChecking(true);
    try {
      const res = await TicketService.checkOrderStatus(orderRef);
      if (res.status === 'paid' && res.tickets && res.tickets.length > 0) {
        setStatus('paid');
        setIssuedTickets(res.tickets);
        if (onPaymentSuccess) onPaymentSuccess();
      } else {
        setMessage(res.message || 'Payment not yet confirmed. Please approve the prompt on your phone and tap Check again.');
      }
    } catch {
      setMessage('Error checking status. Please try again.');
    } finally {
      setManualChecking(false);
    }
  };


  const handleDownloadPdf = async () => {
    if (!activeTicket) return;
    setDownloadingPdf(true);
    try {
      await TicketRenderer.generatePdfTicket(activeTicket);
    } catch (err) {
      console.error('Error creating PDF:', err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadPng = async () => {
    if (!activeTicket) return;
    try {
      await TicketRenderer.downloadTicketImage(activeTicket);
    } catch (err) {
      console.error('Error creating PNG:', err);
    }
  };

  const handleDownloadAllPdf = async () => {
    if (issuedTickets.length === 0) return;
    setDownloadingPdf(true);
    try {
      await TicketRenderer.downloadAllTicketsPdf(issuedTickets);
    } catch (err) {
      console.error('Error downloading tickets:', err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const copyOrderRef = () => {
    navigator.clipboard.writeText(orderRef);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins}:${remainder.toString().padStart(2, '0')}`;
  };

  const verifyUrl = activeTicket
    ? `${window.location.origin}?verify=${activeTicket.qr_token}`
    : '';

  const whatsAppShareHref = activeTicket
    ? `https://wa.me/?text=${encodeURIComponent(
        `My Pool Party 2026 Ticket is confirmed!\n\nPass #${activeTicket.ticket_number} (${activeTicket.category} Pass)\nGuest: ${activeTicket.buyer_name}\nDate: Friday, 11 December 2026\nVenue: Prince Resort, Bunamwaya (Bella), Uganda\n\nVerify Entry: ${verifyUrl}`
      )}`
    : '#';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-black/80 backdrop-blur-sm">
      <div 
        className="relative w-full max-w-3xl bg-[#0d1522] border border-white/15 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
        role="dialog"
      >
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#080c14] border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <Ticket className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm sm:text-base font-bold text-white font-display">
              {status === 'paid' ? 'Ticket Confirmed & Issued' : 'Relworx Mobile Money Payment'}
            </h3>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">

          {/* ==================================================== */}
          {/* STATE 1: PENDING PAYMENT (USSD Prompt on Handset) */}
          {/* ==================================================== */}
          {status === 'pending' && (
            <div className="space-y-5">
              {/* Timer Ribbon */}
              <div className="p-4 rounded-xl bg-[#080c14] border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-white block">
                      10-Minute Ticket Reservation Active
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Inventory locked. Approve the mobile money prompt to issue your ticket.
                    </span>
                  </div>
                </div>

                <div className="px-3.5 py-1.5 bg-[#0d1522] rounded-lg border border-white/10 font-mono font-bold text-amber-300 text-lg tabular-nums">
                  {formatTimer(secondsRemaining)}
                </div>
              </div>

              {/* Handset Instructions */}
              <div className="bg-[#080c14] p-5 rounded-xl border border-white/10 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <Smartphone className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      Check Your {network} Phone Screen
                    </h4>
                    <p className="text-xs text-slate-400">
                      Relworx sent an official Mobile Money prompt to{' '}
                      <strong className="text-white font-mono">{buyerPhone || 'your handset'}</strong>.
                    </p>
                  </div>
                </div>

                {/* Amount to pay */}
                <div className="bg-[#0d1522] p-4 rounded-lg border border-white/5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                      Total Amount
                    </span>
                    <span className="text-xl font-bold text-white font-mono tabular-nums">
                      UGX {totalAmountUgx?.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                      Order Reference
                    </span>
                    <span className="text-xs font-mono text-cyan-300 flex items-center gap-1.5">
                      {orderRef}
                      <button onClick={copyOrderRef} className="hover:text-white p-0.5 cursor-pointer" title="Copy reference">
                        {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </span>
                  </div>
                </div>

                {/* Instructions */}
                <ol className="text-xs text-slate-300 space-y-1.5 list-decimal list-inside p-3 bg-black/20 rounded-lg">
                  <li>Unlock your phone and enter your {network === 'MTN' ? 'MTN MoMo' : 'Airtel Money'} PIN.</li>
                  <li>
                    {network === 'MTN' ? (
                      <span>If no prompt appeared, dial <strong className="text-amber-300 font-mono">*165#</strong> &gt; Pending Approvals.</span>
                    ) : (
                      <span>If no prompt appeared, dial <strong className="text-amber-300 font-mono">*185#</strong> &gt; Pending Approvals.</span>
                    )}
                  </li>
                  <li>Once authorized, this screen updates immediately and issues your personalized pass.</li>
                </ol>
              </div>

              {/* Status Action Button */}
              <div className="space-y-3 pt-1">
                <button
                  onClick={handleManualCheck}
                  disabled={manualChecking}
                  className="w-full py-3 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 font-bold rounded-lg text-xs uppercase tracking-wider shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${manualChecking ? 'animate-spin' : ''}`} />
                  <span>{manualChecking ? 'Verifying with Relworx...' : 'I Approved on My Phone · Check Status'}</span>
                </button>
              </div>
            </div>
          )}

          {/* ==================================================== */}
          {/* STATE 2: PAID (TICKETS ISSUED WITH PERSONALIZED CANVA) */}
          {/* ==================================================== */}
          {status === 'paid' && (
            <div className="space-y-5">
              {/* Clean Success Banner */}
              <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white font-display">
                    Payment Verified Successfully
                  </h4>
                  <p className="text-xs text-emerald-300">
                    {issuedTickets.length} personalized pass(es) issued with verified cryptographic entry tokens.
                  </p>
                </div>
              </div>

              {/* Multi-Ticket Navigation (if buyer bought more than 1 ticket) */}
              {issuedTickets.length > 1 && (
                <div className="flex items-center justify-between bg-[#080c14] p-3 rounded-lg border border-white/10 text-xs">
                  <span className="text-slate-300 font-medium">
                    Showing Ticket {currentTicketIndex + 1} of {issuedTickets.length}:{' '}
                    <strong className="text-amber-300 font-mono">{activeTicket?.ticket_number}</strong>
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setCurrentTicketIndex((prev) => Math.max(0, prev - 1))}
                      disabled={currentTicketIndex === 0}
                      className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white cursor-pointer"
                      title="Previous ticket"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setCurrentTicketIndex((prev) => Math.min(issuedTickets.length - 1, prev + 1))}
                      disabled={currentTicketIndex === issuedTickets.length - 1}
                      className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white cursor-pointer"
                      title="Next ticket"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Canva Ticket Preview */}
              <div className="bg-[#080c14] p-4 rounded-xl border border-white/10 flex flex-col items-center justify-center min-h-[200px]">
                {renderingCanvas ? (
                  <div className="flex flex-col items-center gap-2 text-xs text-amber-300 py-8">
                    <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
                    <span>Rendering personalized Canva pass...</span>
                  </div>
                ) : renderedCanvasUrl ? (
                  <div className="w-full flex flex-col items-center">
                    <img
                      src={renderedCanvasUrl}
                      alt={`Ticket ${activeTicket?.ticket_number}`}
                      className="w-full max-w-2xl h-auto rounded-lg border border-white/15 object-contain shadow-lg"
                    />
                    <div className="mt-2.5 text-center text-xs text-slate-400">
                      Pass Number: <span className="font-mono text-cyan-300 font-bold">{activeTicket?.ticket_number}</span> · Guest:{' '}
                      <span className="text-white font-medium">{activeTicket?.buyer_name}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-rose-400">Could not render ticket canvas.</p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={handleDownloadPdf}
                    disabled={downloadingPdf || renderingCanvas}
                    className="py-3 px-4 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm uppercase cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>{downloadingPdf ? 'Generating PDF...' : 'Download Print PDF'}</span>
                  </button>

                  <button
                    onClick={handleDownloadPng}
                    disabled={renderingCanvas}
                    className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 border border-slate-700 uppercase cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-slate-300" />
                    <span>Download PNG Image</span>
                  </button>
                </div>

                {issuedTickets.length > 1 && (
                  <button
                    onClick={handleDownloadAllPdf}
                    disabled={downloadingPdf}
                    className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-xs font-bold rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download All {issuedTickets.length} Passes (Combined PDF)</span>
                  </button>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs">
                  <a
                    href={whatsAppShareHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 font-semibold cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share on WhatsApp</span>
                  </a>

                  <span className="text-[11px] text-slate-500 font-mono">
                    Order Ref: {orderRef}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================== */}
          {/* STATE 3: EXPIRED RESERVATION */}
          {/* ==================================================== */}
          {status === 'expired' && (
            <div className="p-6 bg-[#080c14] rounded-xl border border-rose-500/30 text-center space-y-4">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white font-display">
                Reservation Expired
              </h4>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                The 10-minute payment window elapsed without confirmation. To avoid overselling the 70-ticket venue capacity, your ticket was returned to inventory.
              </p>
              <button
                onClick={onClose}
                className="px-5 py-2.5 bg-amber-400 text-slate-950 text-xs font-bold rounded-lg cursor-pointer hover:bg-amber-300 uppercase"
              >
                Select New Pass
              </button>
            </div>
          )}

          {/* ==================================================== */}
          {/* STATE 4: FAILED OR CANCELLED */}
          {/* ==================================================== */}
          {status === 'failed' && (
            <div className="p-6 bg-[#080c14] rounded-xl border border-rose-500/30 text-center space-y-4">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white font-display">
                Payment Prompt Declined or Cancelled
              </h4>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {message || 'The transaction was declined by the mobile money network. Please verify your account balance and retry.'}
              </p>
              <button
                onClick={onClose}
                className="px-5 py-2.5 bg-amber-400 text-slate-950 text-xs font-bold rounded-lg cursor-pointer hover:bg-amber-300 uppercase"
              >
                Try Again
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
