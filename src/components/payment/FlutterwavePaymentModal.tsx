import React, { useState, useEffect } from 'react';
import { 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  RefreshCw, 
  ExternalLink, 
  Download, 
  Share2, 
  Ticket, 
  Smartphone, 
  ShieldCheck, 
  Copy, 
  Check,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { TicketService } from '../../lib/ticketService';
import { TicketRenderer } from '../../lib/ticketRenderer';
import { TicketRecord } from '../../types/inventory';
import { OrderStatus } from '../../types/order';

interface FlutterwavePaymentModalProps {
  orderRef: string | null;
  initialMessage?: string;
  authUrl?: string | null;
  reservedUntil?: string | null;
  totalAmountUgx?: number;
  buyerName?: string;
  buyerPhone?: string;
  network?: 'MTN' | 'AIRTEL';
  onClose: () => void;
  onPaymentSuccess?: () => void;
}

export const FlutterwavePaymentModal: React.FC<FlutterwavePaymentModalProps> = ({
  orderRef,
  initialMessage,
  authUrl,
  reservedUntil,
  totalAmountUgx,
  buyerName,
  buyerPhone,
  network = 'MTN',
  onClose,
  onPaymentSuccess,
}) => {
  const [status, setStatus] = useState<OrderStatus>('pending');
  const [message, setMessage] = useState<string>(initialMessage || 'Awaiting mobile money authorization on your phone...');
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

    // Poll every 4 seconds
    const pollInterval = setInterval(() => {
      pollCount++;
      if (pollCount > 150) {
        // Stop polling after 10 minutes
        clearInterval(pollInterval);
        return;
      }
      check();
    }, 4000);

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
      alert('Error creating PDF: ' + err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadPng = async () => {
    if (!activeTicket) return;
    try {
      await TicketRenderer.downloadTicketImage(activeTicket);
    } catch (err) {
      alert('Error creating PNG: ' + err);
    }
  };

  const handleDownloadAllPdf = async () => {
    setDownloadingPdf(true);
    try {
      for (const t of issuedTickets) {
        await TicketRenderer.generatePdfTicket(t);
      }
    } catch (err) {
      alert('Error: ' + err);
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

  const shareWhatsApp = () => {
    if (!activeTicket) return;
    const text = encodeURIComponent(
      `🎉 My Pool Party 2026 Ticket is Confirmed!\n\nTicket: #${activeTicket.ticket_number} (${activeTicket.category} Pass)\nGuest: ${activeTicket.buyer_name}\nDate: Friday, 11 December 2026\nVenue: Prince Resort, Bunamwaya (Bella), Uganda\n\nVerify Entry: ${verifyUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-black/90 backdrop-blur-md">
      <div 
        className="relative w-full max-w-3xl bg-[#070e1b] border-2 border-amber-400/50 rounded-3xl shadow-2xl overflow-hidden my-6 flex flex-col"
        role="dialog"
      >
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#030712] border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Ticket className="w-5 h-5 text-amber-400" />
            <span className="text-sm sm:text-base font-bold text-white font-display">
              {status === 'paid' ? 'Ticket Confirmed & Issued' : 'Flutterwave Mobile Money Payment'}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
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
            <div className="space-y-6">
              {/* Timer & Status Ribbon */}
              <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-400/40 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center shrink-0">
                    <Clock className="w-5 h-5 text-amber-400 animate-pulse" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 block">
                      10-Minute Stock Reservation Active
                    </span>
                    <span className="text-xs text-slate-300">
                      Tickets locked. Authorize the prompt before expiry.
                    </span>
                  </div>
                </div>

                <div className="px-4 py-2 bg-[#030712] rounded-xl border border-amber-400/30 font-mono font-black text-amber-300 text-lg sm:text-xl">
                  {formatTimer(secondsRemaining)}
                </div>
              </div>

              {/* Handset Instructions */}
              <div className="bg-[#030712] p-6 rounded-2xl border border-white/10 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center shrink-0">
                    <Smartphone className="w-5 h-5 text-emerald-400 animate-bounce" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-white">
                      Check Your {network} Handset
                    </h4>
                    <p className="text-xs text-slate-400">
                      Flutterwave sent a Mobile Money authorization prompt to{' '}
                      <strong className="text-amber-300">{buyerPhone || 'your phone'}</strong>.
                    </p>
                  </div>
                </div>

                {/* Amount to pay */}
                <div className="bg-[#070e1b] p-4 rounded-xl border border-white/10 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                      Total Due (Strictly Enforced by Server)
                    </span>
                    <span className="text-xl font-black text-white font-mono">
                      UGX {totalAmountUgx?.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                      Payment Reference
                    </span>
                    <span className="text-xs font-mono text-cyan-300 flex items-center gap-1">
                      {orderRef}
                      <button onClick={copyOrderRef} className="hover:text-white p-0.5">
                        {copiedRef ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </span>
                  </div>
                </div>

                {/* Step by step prompt instructions */}
                <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside bg-black/40 p-4 rounded-xl">
                  <li>Keep your phone screen on and unlocked.</li>
                  <li>Enter your {network === 'MTN' ? 'MTN MoMo' : 'Airtel Money'} PIN to confirm.</li>
                  <li>Once approved, this window will automatically detect payment and generate your tickets.</li>
                </ol>

                {authUrl && (
                  <div className="pt-2 text-center">
                    <a
                      href={authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 underline font-semibold"
                    >
                      <span>Click here if phone did not show prompt (Open Web Authorization)</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={handleManualCheck}
                  disabled={manualChecking}
                  className="flex-1 py-3.5 bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-300 hover:to-amber-200 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <RefreshCw className={`w-4 h-4 ${manualChecking ? 'animate-spin' : ''}`} />
                  <span>{manualChecking ? 'Checking Flutterwave...' : 'I Approved on My Phone · Check Status'}</span>
                </button>
              </div>
            </div>
          )}

          {/* ==================================================== */}
          {/* STATE 2: PAID (TICKETS ISSUED WITH PERSONALIZED CANVA) */}
          {/* ==================================================== */}
          {status === 'paid' && (
            <div className="space-y-6">
              {/* Success Banner */}
              <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/50 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white font-display">
                    Payment Confirmed by Flutterwave!
                  </h4>
                  <p className="text-xs text-emerald-200">
                    Your {issuedTickets.length} personalized entry pass(es) have been issued and cryptographically signed.
                  </p>
                </div>
              </div>

              {/* Multi-Ticket Navigation (if buyer bought more than 1 ticket) */}
              {issuedTickets.length > 1 && (
                <div className="flex items-center justify-between bg-[#030712] p-3 rounded-xl border border-white/10 text-xs">
                  <span className="text-slate-300 font-semibold">
                    Ticket {currentTicketIndex + 1} of {issuedTickets.length}:{' '}
                    <strong className="text-amber-300 font-mono">{activeTicket?.ticket_number}</strong>
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentTicketIndex((prev) => Math.max(0, prev - 1))}
                      disabled={currentTicketIndex === 0}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setCurrentTicketIndex((prev) => Math.min(issuedTickets.length - 1, prev + 1))}
                      disabled={currentTicketIndex === issuedTickets.length - 1}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Canva Ticket Preview */}
              <div className="bg-[#02050b] p-4 rounded-2xl border border-amber-400/30 flex flex-col items-center justify-center min-h-[220px]">
                {renderingCanvas ? (
                  <div className="flex flex-col items-center gap-2 text-xs text-amber-300 py-10">
                    <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
                    <span>Overlaying attendee name & QR code on Canva template...</span>
                  </div>
                ) : renderedCanvasUrl ? (
                  <div className="w-full flex flex-col items-center">
                    <img
                      src={renderedCanvasUrl}
                      alt={`Ticket ${activeTicket?.ticket_number}`}
                      className="w-full max-w-2xl h-auto rounded-lg shadow-2xl border border-amber-400/40 object-contain"
                    />
                    <div className="mt-3 text-center text-xs text-slate-400">
                      Ticket ID: <span className="font-mono text-cyan-300 font-bold">{activeTicket?.ticket_number}</span> · Guest:{' '}
                      <span className="text-white font-medium">{activeTicket?.buyer_name}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-rose-400">Could not render ticket image.</p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={handleDownloadPdf}
                    disabled={downloadingPdf || renderingCanvas}
                    className="py-3 px-4 bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-300 hover:to-amber-200 text-slate-950 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm uppercase cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>{downloadingPdf ? 'Generating PDF...' : 'Download Print-Ready PDF'}</span>
                  </button>

                  <button
                    onClick={handleDownloadPng}
                    disabled={renderingCanvas}
                    className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 border border-white/10 uppercase cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download High-Res PNG</span>
                  </button>
                </div>

                {issuedTickets.length > 1 && (
                  <button
                    onClick={handleDownloadAllPdf}
                    disabled={downloadingPdf}
                    className="w-full py-2.5 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/40 text-cyan-200 text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download All {issuedTickets.length} Tickets (All PDFs)</span>
                  </button>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs">
                  <button
                    onClick={shareWhatsApp}
                    className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 font-semibold cursor-pointer"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Share on WhatsApp</span>
                  </button>

                  <span className="text-[11px] text-slate-500">
                    Ref: <span className="font-mono">{orderRef}</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================== */}
          {/* STATE 3: EXPIRED RESERVATION */}
          {/* ==================================================== */}
          {status === 'expired' && (
            <div className="p-6 bg-[#030712] rounded-2xl border border-rose-500/40 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h4 className="text-lg font-bold text-white font-display">
                Reservation Expired
              </h4>
              <p className="text-xs text-slate-300 max-w-md mx-auto">
                The 10-minute mobile money window elapsed without confirmation. To avoid overselling, your ticket was returned to available stock.
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-amber-400 text-slate-950 text-xs font-bold rounded-xl cursor-pointer hover:bg-amber-300 uppercase"
              >
                Start New Reservation
              </button>
            </div>
          )}

          {/* ==================================================== */}
          {/* STATE 4: FAILED OR CANCELLED */}
          {/* ==================================================== */}
          {status === 'failed' && (
            <div className="p-6 bg-[#030712] rounded-2xl border border-rose-500/40 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h4 className="text-lg font-bold text-white font-display">
                Payment Declined
              </h4>
              <p className="text-xs text-slate-300 max-w-md mx-auto">
                {message || 'The payment could not be processed by your mobile money operator. Please check your balance and try again.'}
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-amber-400 text-slate-950 text-xs font-bold rounded-xl cursor-pointer hover:bg-amber-300 uppercase"
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
