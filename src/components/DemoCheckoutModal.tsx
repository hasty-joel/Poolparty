import React, { useState } from 'react';
import { 
  X, 
  ShieldAlert, 
  Ticket, 
  Copy, 
  Check, 
  Crown,
  Phone
} from 'lucide-react';
import { ReservationOrder, EVENT_DATA } from '../types/event';

interface DemoCheckoutModalProps {
  order: ReservationOrder | null;
  onClose: () => void;
}

export const DemoCheckoutModal: React.FC<DemoCheckoutModalProps> = ({ order, onClose }) => {
  const [showSampleTicket, setShowSampleTicket] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!order) return null;

  const copyOrderRef = () => {
    navigator.clipboard.writeText(order.orderId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getPaymentName = () => {
    switch (order.paymentMethod) {
      case 'mtn_momo':
        return 'MTN Mobile Money (Uganda)';
      case 'airtel_money':
        return 'Airtel Money (Uganda)';
      case 'card':
        return 'Debit / Credit Card';
    }
  };

  const isVip = order.tier === 'vip';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-black/85 backdrop-blur-md">
      <div 
        className="relative w-full max-w-xl bg-[#0a1526] border border-amber-400/40 rounded-3xl shadow-2xl overflow-hidden my-8"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#070e1b] border-b border-white/10">
          <div className="flex items-center gap-2">
            <Ticket className="w-5 h-5 text-amber-400" />
            <h3 className="text-base sm:text-lg font-bold text-white font-display">
              Order Reservation Preview
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

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          
          {/* Honest Demo Mode Banner */}
          <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-400/40 flex items-start gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-200 leading-relaxed">
              <span className="font-bold text-amber-200 uppercase block mb-0.5">
                Sandbox Mode · Payment Gateway Not Yet Connected
              </span>
              This order preview validates checkout details. <strong className="text-white">No real money was debited</strong>. To confirm VIP tables or offline tickets, contact RSVP directly at <strong className="text-amber-300">{EVENT_DATA.rsvpPhone}</strong>.
            </div>
          </div>

          {/* Reservation Summary */}
          <div className="bg-[#050b14] p-4 rounded-xl border border-white/10 space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Reference</span>
                <span className="text-xs font-bold text-white font-mono flex items-center gap-1.5">
                  {order.orderId}
                  <button onClick={copyOrderRef} className="text-slate-400 hover:text-amber-400 p-0.5">
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Selected Tier</span>
                <span className={`text-xs font-extrabold uppercase px-2 py-0.5 rounded ${
                  isVip ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                }`}>
                  {order.tierName} Pass ({order.quantity}×)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-slate-400 block text-[11px]">Attendee</span>
                <span className="font-medium text-white">{order.buyerName}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Contact Phone</span>
                <span className="font-medium text-white">{order.buyerPhone}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Email</span>
                <span className="font-medium text-white break-all">{order.buyerEmail}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Provider</span>
                <span className="font-medium text-amber-300">{getPaymentName()}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-white/10 flex items-center justify-between">
              <span className="text-slate-300 font-semibold">Total Order Amount:</span>
              <span className="text-lg font-black text-amber-300 font-mono">
                UGX {order.totalPrice.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Sample Individualized Ticket Pass */}
          <div className="bg-gradient-to-br from-[#0e213d] to-[#050b14] p-5 rounded-2xl border border-amber-400/40 shadow-inner space-y-3">
            <div className="flex justify-between items-start pb-2 border-b border-white/10">
              <div>
                <div className="flex items-center gap-1.5 text-amber-300 text-[10px] font-bold uppercase tracking-wider">
                  <Crown className="w-3.5 h-3.5" />
                  <span>Prince Resort Bunamwaya Bella</span>
                </div>
                <h4 className="text-xl font-black text-white font-display mt-0.5">
                  POOL PARTY 2026
                </h4>
                <p className="text-[11px] text-slate-300">
                  Friday, Dec 11th · 12 PM till late · Hosted by Trevor DJ
                </p>
              </div>
              <div className="text-right">
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                  isVip ? 'bg-cyan-400 text-slate-950' : 'bg-amber-400 text-slate-950'
                }`}>
                  {order.tierName.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 py-1">
              <div className="space-y-1.5 text-xs">
                <div>
                  <span className="text-slate-400 text-[10px] block">Attendee Name</span>
                  <span className="font-bold text-white text-sm">{order.buyerName}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">Ticket Code</span>
                  <span className="font-mono text-cyan-300 text-xs font-bold">
                    TK-{isVip ? 'VIP' : 'ORD'}-{order.orderId.replace('PP26-UG-', '')}-01
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">Entry Rule</span>
                  <span className="text-slate-300 text-[10px]">Strictly single scan at entrance gate</span>
                </div>
              </div>

              {/* Dynamic QR Code based on order ID */}
              <div className="bg-white p-2.5 rounded-xl shadow-md flex flex-col items-center shrink-0">
                <svg viewBox="0 0 100 100" className="w-20 h-20">
                  <rect x="5" y="5" width="25" height="25" fill="#030712" />
                  <rect x="9" y="9" width="17" height="17" fill="#ffffff" />
                  <rect x="13" y="13" width="9" height="9" fill="#030712" />

                  <rect x="70" y="5" width="25" height="25" fill="#030712" />
                  <rect x="74" y="9" width="17" height="17" fill="#ffffff" />
                  <rect x="78" y="13" width="9" height="9" fill="#030712" />

                  <rect x="5" y="70" width="25" height="25" fill="#030712" />
                  <rect x="9" y="74" width="17" height="17" fill="#ffffff" />
                  <rect x="13" y="78" width="9" height="9" fill="#030712" />

                  <rect x="36" y="8" width="6" height="6" fill="#030712" />
                  <rect x="48" y="14" width="6" height="6" fill="#030712" />
                  <rect x="42" y="24" width="6" height="6" fill="#030712" />
                  <rect x="56" y="20" width="6" height="6" fill="#030712" />

                  <rect x="14" y="38" width="6" height="6" fill="#030712" />
                  <rect x="24" y="46" width="6" height="6" fill="#030712" />
                  <rect x="36" y="40" width="6" height="6" fill="#030712" />
                  <rect x="48" y="48" width="6" height="6" fill="#030712" />
                  <rect x="60" y="38" width="6" height="6" fill="#030712" />
                  <rect x="74" y="44" width="6" height="6" fill="#030712" />

                  <rect x="40" y="62" width="6" height="6" fill="#030712" />
                  <rect x="52" y="72" width="6" height="6" fill="#030712" />
                  <rect x="64" y="64" width="6" height="6" fill="#030712" />
                  <rect x="78" y="76" width="6" height="6" fill="#030712" />
                </svg>
                <span className="text-[8px] font-mono text-slate-800 font-bold tracking-tight mt-0.5">
                  GATE-PASS
                </span>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 text-center border-t border-white/10 pt-1.5">
              Individual pass preview. Unique QR assigned upon payment confirmation.
            </p>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#070e1b] border-t border-white/10 flex items-center justify-between">
          <a
            href={`tel:${EVENT_DATA.rsvpTel}`}
            className="text-xs font-semibold text-amber-300 hover:text-amber-200 flex items-center gap-1.5"
          >
            <Phone className="w-3.5 h-3.5" />
            <span>Call RSVP: {EVENT_DATA.rsvpPhone}</span>
          </a>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer uppercase"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
