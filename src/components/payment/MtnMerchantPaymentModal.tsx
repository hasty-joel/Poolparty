import React, { useState, useEffect, useRef } from 'react';
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
  ShieldCheck, 
  Copy, 
  Check,
  ChevronLeft,
  ChevronRight,
  Send,
  AlertTriangle,
  PhoneCall,
  ArrowDown
} from 'lucide-react';
import { TicketService } from '../../lib/ticketService';
import { TicketRenderer } from '../../lib/ticketRenderer';
import { WhatsAppService } from '../../lib/whatsappService';
import { TicketRecord, TicketCategory } from '../../types/inventory';
import { OrderStatus, VerificationStatus } from '../../types/order';

interface MtnMerchantPaymentModalProps {
  orderRef: string | null;
  initialMessage?: string;
  reservedUntil?: string | null;
  totalAmountUgx?: number;
  buyerName?: string;
  buyerPhone?: string;
  buyerEmail?: string;
  category?: TicketCategory;
  quantity?: number;
  merchantCode?: string;
  merchantName?: string;
  ussdCode?: string;
  isConfigured?: boolean;
  onClose: () => void;
  onPaymentSuccess?: () => void;
}

export const MtnMerchantPaymentModal: React.FC<MtnMerchantPaymentModalProps> = ({
  orderRef,
  initialMessage,
  reservedUntil,
  totalAmountUgx = 20000,
  buyerName = '',
  buyerPhone = '',
  buyerEmail = '',
  category = 'ORDINARY',
  quantity = 1,
  merchantCode: initialMerchantCode,
  merchantName: initialMerchantName,
  ussdCode: initialUssdCode,
  isConfigured: initialIsConfigured,
  onClose,
  onPaymentSuccess,
}) => {
  const [status, setStatus] = useState<OrderStatus>('pending');
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('unsubmitted');
  const [secondsRemaining, setSecondsRemaining] = useState<number>(900); // 15 mins default
  const [issuedTickets, setIssuedTickets] = useState<TicketRecord[]>([]);
  const [currentTicketIndex, setCurrentTicketIndex] = useState<number>(0);
  const [renderedCanvasUrl, setRenderedCanvasUrl] = useState<string | null>(null);
  const [renderingCanvas, setRenderingCanvas] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  
  // Copy state & fallbacks
  const [copiedRef, setCopiedRef] = useState(false);
  const [copiedMerchantCode, setCopiedMerchantCode] = useState(false);
  const [copyCodeFailed, setCopyCodeFailed] = useState(false);
  const [copyRefFailed, setCopyRefFailed] = useState(false);

  // WhatsApp share
  const [isSharingWhatsApp, setIsSharingWhatsApp] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  // Merchant & USSD configuration
  const [merchantCode, setMerchantCode] = useState<string | undefined>(initialMerchantCode);
  const [merchantName, setMerchantName] = useState<string>(initialMerchantName || 'Prince Resort (Pool Party)');
  const [ussdCode, setUssdCode] = useState<string>(initialUssdCode || '*165*3#');
  const [ussdDialUrl, setUssdDialUrl] = useState<string>(`tel:${(initialUssdCode || '*165*3#').replace(/#/g, '%23')}`);
  const [isConfigured, setIsConfigured] = useState<boolean>(initialIsConfigured !== false);
  const [configWarning, setConfigWarning] = useState<string | null>(null);

  // Submission Form State
  const [transactionId, setTransactionId] = useState('');
  const [payerPhone, setPayerPhone] = useState(buyerPhone);
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  const step2FormRef = useRef<HTMLFormElement | null>(null);

  // Load latest MTN config if not provided
  useEffect(() => {
    TicketService.getMtnConfig().then((cfg) => {
      setIsConfigured(cfg.configured);
      if (cfg.merchantCode) setMerchantCode(cfg.merchantCode);
      if (cfg.merchantName) setMerchantName(cfg.merchantName);
      if (cfg.instructions?.ussdCode) {
        setUssdCode(cfg.instructions.ussdCode);
        setUssdDialUrl(cfg.instructions.ussdDialUrl || `tel:${cfg.instructions.ussdCode.replace(/#/g, '%23')}`);
      }
      if (cfg.warning) setConfigWarning(cfg.warning);
    });
  }, []);

  // Reservation countdown timer
  useEffect(() => {
    if (!reservedUntil || status === 'paid' || status === 'failed' || status === 'expired') return;

    const interval = setInterval(() => {
      const now = Date.now();
      const expiry = new Date(reservedUntil).getTime();
      const diffSecs = Math.max(0, Math.floor((expiry - now) / 1000));
      setSecondsRemaining(diffSecs);

      if (diffSecs <= 0) {
        setStatus('expired');
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [reservedUntil, status]);

  // Live polling for payment verification status
  useEffect(() => {
    if (!orderRef || status === 'paid') return;

    let isMounted = true;
    const check = async () => {
      try {
        const res = await TicketService.checkOrderStatus(orderRef);
        if (!isMounted) return;

        if (res.status === 'paid' && res.tickets && res.tickets.length > 0) {
          setStatus('paid');
          setVerificationStatus('verified');
          setIssuedTickets(res.tickets);
          if (onPaymentSuccess) onPaymentSuccess();
          return;
        }

        if (res.verificationStatus) {
          setVerificationStatus(res.verificationStatus);
        }

        if (res.status === 'failed' || res.status === 'cancelled') {
          setStatus('failed');
          if (res.rejectionReason) setRejectionReason(res.rejectionReason);
          return;
        }

        if (res.status === 'expired') {
          setStatus('expired');
          return;
        }

        if (res.secondsRemaining !== undefined) {
          setSecondsRemaining(res.secondsRemaining);
        }
      } catch (err) {
        console.warn('Polling check error:', err);
      }
    };

    // Initial check
    check();

    // Poll every 5 seconds
    const interval = setInterval(check, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [orderRef, status, onPaymentSuccess]);

  // Render Canva Ticket Preview when tickets are issued
  useEffect(() => {
    if (status !== 'paid' || issuedTickets.length === 0) return;

    const ticket = issuedTickets[currentTicketIndex];
    if (!ticket) return;

    setRenderingCanvas(true);
    TicketRenderer.renderTicketToDataUrl(ticket)
      .then((url) => {
        setRenderedCanvasUrl(url);
      })
      .catch((err) => {
        console.error('Canvas render error:', err);
      })
      .finally(() => {
        setRenderingCanvas(false);
      });
  }, [status, issuedTickets, currentTicketIndex]);

  const copyToClipboard = async (text: string, type: 'ref' | 'code') => {
    let successful = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        successful = true;
      }
    } catch {
      successful = false;
    }

    if (!successful && typeof document !== 'undefined') {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        successful = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch {
        successful = false;
      }
    }

    if (type === 'ref') {
      setCopiedRef(successful);
      setCopyRefFailed(!successful);
      setTimeout(() => {
        setCopiedRef(false);
        setCopyRefFailed(false);
      }, 2500);
    } else {
      setCopiedMerchantCode(successful);
      setCopyCodeFailed(!successful);
      setTimeout(() => {
        setCopiedMerchantCode(false);
        setCopyCodeFailed(false);
      }, 2500);
    }
  };

  const handleScrollToStep2 = () => {
    if (step2FormRef.current) {
      step2FormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const input = document.getElementById('mtn-tx-input');
      if (input) input.focus();
    }
  };

  const handleSubmitTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderRef || submitting) return;

    setSubmitError(null);
    const cleanedTx = transactionId.trim().toUpperCase();

    if (!cleanedTx || cleanedTx.length < 5) {
      setSubmitError('Please enter a valid MTN Transaction ID from your confirmation SMS (at least 5 characters).');
      return;
    }

    if (!payerPhone || payerPhone.trim().length < 9) {
      setSubmitError('Please enter the MTN phone number used to make the payment.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await TicketService.submitMtnTransaction({
        orderRef,
        mtnTransactionId: cleanedTx,
        payerPhone: payerPhone.trim(),
        notes: submissionNotes.trim() || undefined,
      });

      if (!res.success) {
        setSubmitError(res.message || 'Could not submit transaction ID. Please check the details and try again.');
        return;
      }

      setVerificationStatus('pending_verification');
    } catch (err: any) {
      setSubmitError(err?.message || 'Error submitting payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadPdf = async () => {
    const ticket = issuedTickets[currentTicketIndex];
    if (!ticket) return;

    setDownloadingPdf(true);
    try {
      await TicketRenderer.downloadTicketPdf(ticket);
    } catch (err) {
      console.error('PDF error:', err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadPng = () => {
    if (!renderedCanvasUrl) return;
    const ticket = issuedTickets[currentTicketIndex];
    const link = document.createElement('a');
    link.download = `PoolParty-Ticket-${ticket?.ticket_number || 'Pass'}.png`;
    link.href = renderedCanvasUrl;
    link.click();
  };

  const handleShareWhatsApp = async () => {
    const ticket = issuedTickets[currentTicketIndex];
    if (!ticket) return;

    setIsSharingWhatsApp(true);
    setShareFeedback(null);

    const verifyUrl = `${window.location.origin}?verify=${encodeURIComponent(ticket.qr_token)}`;
    const message = `🎉 I'm attending POOL PARTY 2026 at Prince Resort Bunamwaya (Bella), Uganda!\n\n🎟️ Pass #${ticket.ticket_number} (${ticket.category} Pass)\n👤 Guest: ${ticket.buyer_name || buyerName || 'Guest'}\n🔗 Verify: ${verifyUrl}\n\nVenue: Prince Resort, Bunamwaya (Bella), Uganda\nDate: Friday, 11 December 2026\nGet your passes now!`;

    try {
      const res = await WhatsAppService.shareTicketWithAutoPng({
        ticket,
        message,
        phone: ticket.buyer_phone || buyerPhone || '',
      });

      if (res.attachedViaShare) {
        setShareFeedback('Ticket PNG downloaded & attached to WhatsApp share sheet!');
      } else if (res.downloaded) {
        setShareFeedback('Ticket PNG downloaded automatically! Paste or attach it into your WhatsApp message.');
      }
      setTimeout(() => setShareFeedback(null), 6000);
    } catch (err) {
      console.error('Error sharing ticket via WhatsApp:', err);
    } finally {
      setIsSharingWhatsApp(false);
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 xs:p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-[#080E1E] border border-amber-500/30 rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[94vh] flex flex-col">
        
        {/* MTN MoMo Signature Accent Top Bar */}
        <div className="h-1.5 sm:h-2 w-full bg-gradient-to-r from-[#FFCC00] via-[#FFD700] to-[#FF9900] shrink-0" />

        {/* Modal Header */}
        <div className="px-3.5 sm:px-5 py-3 sm:py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#FFCC00] flex items-center justify-center text-slate-950 font-black text-xs sm:text-sm shadow-md border border-amber-300 shrink-0">
              MoMo
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-bold text-white truncate">MTN Mobile Money</h3>
                <span className="text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full bg-[#FFCC00]/15 text-[#FFCC00] border border-[#FFCC00]/30 shrink-0">
                  MoMoPay Merchant
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Prince Resort Bunamwaya · 11 Dec 2026
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-3.5 sm:p-5 sm:p-6 space-y-4 sm:space-y-6 max-h-[calc(94vh-65px)] overflow-y-auto">

          {/* 1. Confirmed & Paid State: Show Official Tickets */}
          {status === 'paid' && (
            <div className="space-y-6 text-center animate-in zoom-in-95 duration-200">
              <div className="w-14 h-14 bg-emerald-500/20 border border-emerald-500/40 rounded-full flex items-center justify-center mx-auto text-emerald-400 shadow-lg">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Payment Verified · Tickets Issued
                </span>
                <h4 className="text-2xl font-black text-white font-display mt-2">
                  You're Going to Pool Party!
                </h4>
                <p className="text-sm text-slate-300 mt-1">
                  Your MTN Mobile Money payment has been verified by the event team. Your official QR pass is activated below.
                </p>
              </div>

              {/* Ticket Navigator if multiple */}
              {issuedTickets.length > 1 && (
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => setCurrentTicketIndex((p) => Math.max(0, p - 1))}
                    disabled={currentTicketIndex === 0}
                    className="p-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-semibold text-slate-300">
                    Ticket {currentTicketIndex + 1} of {issuedTickets.length}
                  </span>
                  <button
                    onClick={() => setCurrentTicketIndex((p) => Math.min(issuedTickets.length - 1, p + 1))}
                    disabled={currentTicketIndex === issuedTickets.length - 1}
                    className="p-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Canva Ticket Preview */}
              <div className="bg-slate-950 p-2 rounded-xl border border-amber-500/30 shadow-2xl relative overflow-hidden flex items-center justify-center min-h-[160px]">
                {renderingCanvas && (
                  <div className="flex flex-col items-center justify-center gap-2 py-8">
                    <RefreshCw className="w-6 h-6 text-amber-400 animate-spin" />
                    <span className="text-xs text-slate-400">Rendering high-resolution pass...</span>
                  </div>
                )}
                {renderedCanvasUrl && !renderingCanvas && (
                  <img
                    src={renderedCanvasUrl}
                    alt="Official Event Pass"
                    className="w-full h-auto rounded-lg shadow-md"
                  />
                )}
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{downloadingPdf ? 'Generating PDF...' : 'Download PDF'}</span>
                </button>
                <button
                  onClick={handleDownloadPng}
                  disabled={!renderedCanvasUrl}
                  className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 border border-slate-700 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Save Image (PNG)</span>
                </button>
                <button
                  onClick={handleShareWhatsApp}
                  disabled={isSharingWhatsApp}
                  className="w-full py-2.5 px-3 rounded-xl bg-[#25D366] hover:bg-[#20ba59] text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors shadow-sm"
                  title="Automatically download ticket PNG and share on WhatsApp"
                >
                  <Share2 className="w-4 h-4" />
                  <span>{isSharingWhatsApp ? 'Preparing PNG...' : 'Share Pass (WhatsApp)'}</span>
                </button>
              </div>

              {shareFeedback && (
                <div className="p-2.5 rounded-lg bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 text-xs flex items-center justify-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{shareFeedback}</span>
                </div>
              )}

              <p className="text-[11px] text-slate-400">
                A confirmation has been saved. You can also retrieve your pass anytime using your phone number or Order Ref: <strong className="text-amber-300">{orderRef}</strong>.
              </p>
            </div>
          )}

          {/* 2. Expired State */}
          {status === 'expired' && (
            <div className="py-8 text-center space-y-4">
              <div className="w-14 h-14 bg-rose-500/20 border border-rose-500/40 rounded-full flex items-center justify-center mx-auto text-rose-400">
                <Clock className="w-8 h-8" />
              </div>
              <h4 className="text-xl font-bold text-white">Reservation Window Expired</h4>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                The 15-minute hold on your tickets has lapsed and they have been returned to inventory to prevent overselling.
              </p>
              <button
                onClick={onClose}
                className="py-2.5 px-6 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold cursor-pointer"
              >
                Close & Select Passes Again
              </button>
            </div>
          )}

          {/* 3. Rejected State */}
          {status === 'failed' && (
            <div className="py-8 text-center space-y-4">
              <div className="w-14 h-14 bg-rose-500/20 border border-rose-500/40 rounded-full flex items-center justify-center mx-auto text-rose-400">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h4 className="text-xl font-bold text-white">Payment Verification Issue</h4>
              <p className="text-sm text-slate-300 max-w-md mx-auto">
                {rejectionReason || 'The submitted transaction ID could not be matched on the MTN merchant account.'}
              </p>
              <p className="text-xs text-slate-400">
                If you made a payment, please contact event support via RSVP at <strong className="text-amber-300">+256 775 198484</strong> with your MTN SMS.
              </p>
              <button
                onClick={() => setStatus('pending')}
                className="py-2.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer"
              >
                Re-enter Transaction ID
              </button>
            </div>
          )}

          {/* 4. Active Pending State (Unsubmitted OR Awaiting Verification) */}
          {status === 'pending' && (
            <>
              {/* Order Summary & Expiry Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 sm:p-3.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="min-w-0 max-w-[200px] xs:max-w-none">
                  <span className="text-[10.5px] text-slate-400 uppercase font-semibold block">Order Reference</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-mono text-xs sm:text-sm font-bold text-white break-all select-all">{orderRef}</span>
                    <button
                      type="button"
                      onClick={() => orderRef && copyToClipboard(orderRef, 'ref')}
                      className="text-slate-400 hover:text-amber-300 p-1 cursor-pointer shrink-0 min-w-[28px] min-h-[28px] flex items-center justify-center"
                      title="Copy Order Reference"
                    >
                      {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    {copiedRef && <span className="text-[10px] text-emerald-400 font-bold">Copied!</span>}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[10.5px] text-slate-400 uppercase font-semibold block">Total Due</span>
                  <span className="font-mono text-sm sm:text-base font-black text-[#FFCC00]">
                    UGX {totalAmountUgx.toLocaleString()}
                  </span>
                </div>

                <div className="w-full pt-2 mt-1 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-1 text-[11px] sm:text-xs text-slate-400">
                  <span className="text-slate-300 truncate max-w-[220px] xs:max-w-none">
                    {quantity}x {category} Pass for <strong className="text-white">{buyerName}</strong>
                  </span>
                  <div className="inline-flex items-center gap-1 text-amber-400 font-mono font-bold shrink-0">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Hold: {formatTimer(secondsRemaining)}</span>
                  </div>
                </div>
              </div>

              {/* Merchant Code Not Configured Warning */}
              {!isConfigured && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold text-amber-300 mb-1">MTN Merchant Code Not Configured</h5>
                    <p className="text-slate-300 leading-relaxed">
                      {configWarning || 'The event administrator has not yet configured the MTN_MERCHANT_CODE setting in the server environment variables.'}
                    </p>
                    <p className="mt-2 text-slate-400 text-[11px]">
                      Administrator: Please set <code className="bg-slate-900 px-1.5 py-0.5 rounded text-amber-300 font-mono">MTN_MERCHANT_CODE="YOUR_CODE"</code> in your environment.
                    </p>
                  </div>
                </div>
              )}

              {/* Step 1: Merchant Payment Instructions Card */}
              {isConfigured && merchantCode && (
                <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-[#121E3A] via-[#0E172E] to-[#0A1124] border-2 border-[#FFCC00]/40 shadow-xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#FFCC00] flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#FFCC00] animate-pulse" />
                      Step 1: Pay to MTN Merchant Code
                    </span>
                    <span className="text-[11px] font-mono font-bold text-slate-300 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-700">
                      Entry: {ussdCode}
                    </span>
                  </div>

                  {/* Merchant Code & Amount Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {/* Merchant Code Box */}
                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-amber-400/30 flex flex-col justify-between gap-2.5">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                          Merchant Code
                        </span>
                        <span className="text-2xl sm:text-3xl font-black font-mono text-[#FFCC00] tracking-wider select-all">
                          {merchantCode}
                        </span>
                        <span className="text-[10.5px] text-slate-300 block mt-0.5 truncate">
                          {merchantName}
                        </span>
                      </div>
                      
                      <button
                        type="button"
                        onClick={() => copyToClipboard(merchantCode, 'code')}
                        className="w-full py-2 px-3 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer border border-amber-400/30"
                      >
                        {copiedMerchantCode ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Copied Merchant Code!</span>
                          </>
                        ) : copyCodeFailed ? (
                          <>
                            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                            <span>Select Code: {merchantCode}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Merchant Code</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Exact Amount Box */}
                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between gap-2.5">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                          Exact Amount Due
                        </span>
                        <span className="text-2xl sm:text-3xl font-black font-mono text-white tracking-wide">
                          UGX {totalAmountUgx.toLocaleString()}
                        </span>
                        <span className="text-[10.5px] text-emerald-400 block mt-0.5 font-medium">
                          Exact Event Price (Zero Markup)
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Payment Reference: <strong className="text-amber-300 font-mono">{orderRef}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Primary Action Buttons: Open MTN USSD & I've Paid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <a
                      href={ussdDialUrl}
                      className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#FFCC00] via-[#FFD700] to-[#FF9900] hover:brightness-110 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-98 cursor-pointer text-center"
                      title="Open phone dialer with MTN USSD code prefilled"
                    >
                      <PhoneCall className="w-4 h-4 fill-current shrink-0" />
                      <span>Open MTN USSD ({ussdCode})</span>
                    </a>

                    <button
                      type="button"
                      onClick={handleScrollToStep2}
                      className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer text-center"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>I've Paid — Enter Transaction ID</span>
                    </button>
                  </div>

                  {/* USSD Prompt Walkthrough */}
                  <div className="bg-slate-950/70 p-3.5 sm:p-4 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-2">
                    <div className="font-semibold text-white flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-amber-400" />
                      <span>How to pay on your phone:</span>
                    </div>
                    
                    <ol className="list-decimal list-inside space-y-1.5 text-slate-300 text-[11.5px] pl-1 leading-relaxed">
                      <li>
                        Tap <strong className="text-amber-300">Open MTN USSD</strong> above (or dial <strong className="text-[#FFCC00] font-mono">{ussdCode}</strong> in your phone dialer).
                      </li>
                      <li>
                        Select the merchant-payment option (<strong>MoMoPay</strong>) on the MTN menu.
                      </li>
                      <li>
                        When prompted for Merchant Code, enter or paste: <strong className="text-[#FFCC00] font-mono">{merchantCode}</strong> (tap "Copy Merchant Code" above).
                      </li>
                      <li>
                        Enter the exact Amount: <strong className="text-white font-mono">UGX {totalAmountUgx.toLocaleString()}</strong>.
                      </li>
                      <li>
                        When prompted for Reference / Reason, enter: <strong className="text-amber-300 font-mono">{orderRef}</strong>.
                      </li>
                      <li>
                        Enter your secret <strong className="text-white">MTN Mobile Money PIN</strong> on your device to authorize the payment.
                      </li>
                      <li>
                        Keep the confirmation SMS from MTN and copy the <strong className="text-amber-300">Transaction ID</strong>.
                      </li>
                    </ol>

                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10.5px] text-amber-200/90 flex items-start gap-2 mt-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <p>
                        <strong>Phone Handset Requirement:</strong> Browser security does not allow websites to control the USSD session or type inside USSD prompts. You must complete and authorize the transfer using your PIN on your phone handset.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Submission Form (If unsubmitted) */}
              {verificationStatus === 'unsubmitted' && (
                <form
                  ref={step2FormRef}
                  onSubmit={handleSubmitTransaction}
                  className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4 shadow-xl"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      Step 2: Submit Your MTN Transaction ID
                    </span>
                    <span className="text-[11px] text-slate-400">From MTN SMS</span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    After completing payment on your handset, enter the official MTN Transaction ID below. The organizer team will verify your transaction against the merchant ledger and activate your official QR ticket pass.
                  </p>

                  {submitError && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{submitError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="mtn-tx-input" className="text-[11px] font-semibold text-slate-300 block mb-1">
                        MTN Transaction ID <span className="text-rose-400">*</span>
                      </label>
                      <input
                        id="mtn-tx-input"
                        type="text"
                        value={transactionId}
                        onChange={(e) => setTransactionId(e.target.value.toUpperCase())}
                        placeholder="e.g. 1029384756"
                        required
                        className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-base sm:text-sm min-h-[46px] focus:outline-none focus:border-amber-400 transition"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        Found in your MTN confirmation SMS
                      </span>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                        Payer Phone Number <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={payerPhone}
                        onChange={(e) => setPayerPhone(e.target.value)}
                        placeholder="e.g. 0775 198 484"
                        required
                        className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-base sm:text-sm min-h-[46px] focus:outline-none focus:border-amber-400 transition"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        The phone line that sent the funds
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                      Additional Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={submissionNotes}
                      onChange={(e) => setSubmissionNotes(e.target.value)}
                      placeholder="e.g. Sent from Michael's secondary line"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs min-h-[42px] focus:outline-none focus:border-slate-600 transition"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full min-h-[48px] py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#FFCC00] via-[#FFD700] to-[#FF9900] hover:brightness-110 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition cursor-pointer disabled:opacity-50 text-center"
                  >
                    {submitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-slate-950 shrink-0" />
                        <span>Validating & Submitting...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 text-slate-950 shrink-0" />
                        <span>Submit MTN Transaction for Verification</span>
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* Step 3: Pending Verification Status (After user submits) */}
              {verificationStatus === 'pending_verification' && (
                <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-center space-y-4">
                  <div className="w-12 h-12 bg-amber-500/20 border border-amber-500/40 rounded-full flex items-center justify-center mx-auto text-amber-400">
                    <Clock className="w-6 h-6 animate-pulse" />
                  </div>

                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                      Awaiting Admin Verification
                    </span>
                    <h5 className="text-lg font-bold text-white mt-2">
                      Transaction Submitted Successfully!
                    </h5>
                    <p className="text-xs text-slate-300 max-w-md mx-auto mt-1 leading-relaxed">
                      We have logged your MTN payment with Transaction ID <strong className="text-amber-300 font-mono">{transactionId || 'RECORDED'}</strong>.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-xs text-slate-400 max-w-md mx-auto space-y-1 text-left">
                    <div className="flex items-center gap-2 text-slate-300">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>The administrator will confirm this payment against the MTN Merchant portal.</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-300">
                      <Ticket className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Your QR code will be activated as soon as it is confirmed.</span>
                    </div>
                  </div>

                  <div className="pt-1 flex flex-col sm:flex-row items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (orderRef) TicketService.checkOrderStatus(orderRef);
                      }}
                      className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Check Status Now</span>
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="py-2 px-4 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold cursor-pointer"
                    >
                      Done (You Can Check Back Later)
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

        </div>

        {/* Modal Footer Security Note */}
        <div className="px-5 py-3 border-t border-slate-900 bg-slate-950/80 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Anti-Fraud Protected: Duplicate transaction IDs are automatically rejected</span>
          </div>
          <span className="font-mono text-slate-500">Pool Party 2026</span>
        </div>

      </div>
    </div>
  );
};
