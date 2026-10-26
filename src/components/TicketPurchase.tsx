import React, { useState, useEffect } from 'react';
import { 
  Ticket, 
  Minus, 
  Plus, 
  CheckCircle2, 
  AlertCircle, 
  Crown,
  ArrowRight,
  Search,
  RefreshCw,
  Clock
} from 'lucide-react';
import { EVENT_DATA, TICKET_TIERS, TicketTier, BuyerForm } from '../types/event';
import { TicketService } from '../lib/ticketService';
import { TicketRecord, PublicInventoryCounts } from '../types/inventory';
import { RelworxPaymentModal } from './payment/RelworxPaymentModal';
import { TicketLookupModal } from './ticket/TicketLookupModal';

interface TicketPurchaseProps {
  onContinueToPayment: (ticket: TicketRecord) => void;
}

export const TicketPurchase: React.FC<TicketPurchaseProps> = ({ onContinueToPayment }) => {
  const [selectedTier, setSelectedTier] = useState<TicketTier>('ordinary');
  const [quantity, setQuantity] = useState<number>(1);
  const [network, setNetwork] = useState<'MTN' | 'AIRTEL'>('MTN');
  const [form, setForm] = useState<BuyerForm>({
    fullName: '',
    email: '',
    phone: '',
    tier: 'ordinary',
    quantity: 1,
    paymentMethod: 'mtn_momo',
  });
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [publicCounts, setPublicCounts] = useState<PublicInventoryCounts | null>(null);

  // Relworx Checkout Modal State
  const [checkoutModal, setCheckoutModal] = useState<{
    orderRef: string;
    message: string;
    reservedUntil?: string | null;
    totalAmountUgx?: number;
    buyerName?: string;
    buyerPhone?: string;
    network?: 'MTN' | 'AIRTEL';
  } | null>(null);

  // Ticket Lookup Modal State
  const [lookupOpen, setLookupOpen] = useState(false);

  const refreshCounts = () => {
    TicketService.getPublicCounts().then(setPublicCounts);
  };

  useEffect(() => {
    refreshCounts();
  }, []);

  const tierInfo = TICKET_TIERS[selectedTier];
  const unitPrice = tierInfo.priceUgx;
  const totalPrice = unitPrice * quantity;

  // Remaining inventory calculation from public counts endpoint (RLS & privacy preserved)
  const remainingInventory = publicCounts
    ? selectedTier === 'vip'
      ? publicCounts.VIP.available
      : publicCounts.ORDINARY.available
    : selectedTier === 'vip' ? 20 : 50;

  const handleTierChange = (tier: TicketTier) => {
    setSelectedTier(tier);
  };

  const handleQuantityChange = (delta: number) => {
    const next = quantity + delta;
    if (next >= 1 && next <= Math.min(10, remainingInventory)) {
      setQuantity(next);
    }
  };

  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};

    if (!form.fullName.trim() || form.fullName.trim().length < 3) {
      errs.fullName = 'Please enter your full name as it will appear on your pass.';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.email.trim() || !emailRegex.test(form.email)) {
      errs.email = 'Please provide a valid email address.';
    }

    const cleanedPhone = form.phone.replace(/[\s-]/g, '');
    if (!cleanedPhone || cleanedPhone.length < 9) {
      errs.phone = 'Please provide a valid Uganda phone number (e.g. 0775 198 484).';
    }

    if (remainingInventory < quantity) {
      errs.inventory = `Only ${remainingInventory} ${selectedTier.toUpperCase()} pass(es) remaining in stock.`;
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      let res = await TicketService.initiateRelworxPayment({
        category: selectedTier === 'vip' ? 'VIP' : 'ORDINARY',
        quantity,
        buyerName: form.fullName.trim(),
        buyerEmail: form.email.trim(),
        buyerPhone: form.phone.trim(),
        network,
      });

      // If live Relworx account has API access disabled, fall back to sandbox testing simulation mode
      if (!res.success && res.message?.includes('API disabled')) {
        console.warn('[Relworx] Live API reports disabled account, initiating in sandbox testing simulation mode.');
        res = await TicketService.initiateRelworxPayment({
          category: selectedTier === 'vip' ? 'VIP' : 'ORDINARY',
          quantity,
          buyerName: form.fullName.trim(),
          buyerEmail: form.email.trim(),
          buyerPhone: form.phone.trim(),
          network,
          isSandbox: true,
        });
      }

      if (!res.success || !res.orderRef) {
        setErrors({ inventory: res.message || 'Payment initiation failed. Please try again.' });
        setIsSubmitting(false);
        return;
      }

      // Refresh stock counts
      refreshCounts();

      // Open Relworx checkout modal
      setCheckoutModal({
        orderRef: res.orderRef,
        message: res.message,
        reservedUntil: res.reservedUntil,
        totalAmountUgx: res.totalAmountUgx || totalPrice,
        buyerName: form.fullName.trim(),
        buyerPhone: form.phone.trim(),
        network,
      });
    } catch (err: any) {
      setErrors({ inventory: err?.message || 'Error processing reservation' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="tickets" className="py-20 bg-[#080c14] relative border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="max-w-2xl mb-10">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-1">
            <span className="text-amber-400 font-bold uppercase tracking-wider">Official Ticketing</span>
            <span aria-hidden="true">·</span>
            <span>Capacity strictly limited to 70 total passes</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white font-display">
            Select Your Pool Pass
          </h2>
          <p className="text-slate-400 text-sm mt-2">
            Ordinary Pass (UGX 20,000) or VIP Pass (UGX 50,000). Powered by Relworx Uganda Mobile Money.
          </p>

          <div className="mt-3">
            <button
              onClick={() => setLookupOpen(true)}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Already purchased? Retrieve & download your tickets</span>
            </button>
          </div>
        </div>

        {/* Tier Selector Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mb-8">
          
          {/* Ordinary Tier Button */}
          <button
            type="button"
            onClick={() => handleTierChange('ordinary')}
            className={`p-5 rounded-xl border text-left transition-colors cursor-pointer relative ${
              selectedTier === 'ordinary'
                ? 'bg-[#0d1522] border-amber-400'
                : 'bg-[#0d1522]/50 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                General Entry
              </span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-200">
                ORD
              </span>
            </div>
            <div className="text-2xl font-black text-white font-display">
              Ordinary Pass
            </div>
            <div className="text-xl font-bold text-white font-mono mt-1 tabular-nums">
              UGX 20,000
            </div>
            
            <div className="mt-4 flex items-center justify-between text-xs pt-3 border-t border-white/10 text-slate-400">
              <span>Available Inventory</span>
              <span className="font-semibold text-white font-mono tabular-nums">
                {publicCounts ? publicCounts.ORDINARY.available : 50} / 50 Remaining
              </span>
            </div>
          </button>

          {/* VIP Tier Button */}
          <button
            type="button"
            onClick={() => handleTierChange('vip')}
            className={`p-5 rounded-xl border text-left transition-colors cursor-pointer relative ${
              selectedTier === 'vip'
                ? 'bg-[#0d1522] border-cyan-400'
                : 'bg-[#0d1522]/50 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5" />
                <span>VIP Experience</span>
              </span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
                VIP
              </span>
            </div>
            <div className="text-2xl font-black text-white font-display">
              VIP Pass
            </div>
            <div className="text-xl font-bold text-cyan-300 font-mono mt-1 tabular-nums">
              UGX 50,000
            </div>

            <div className="mt-4 flex items-center justify-between text-xs pt-3 border-t border-white/10 text-slate-400">
              <span>Available Inventory</span>
              <span className="font-semibold text-cyan-300 font-mono tabular-nums">
                {publicCounts ? publicCounts.VIP.available : 20} / 20 Remaining
              </span>
            </div>
          </button>

        </div>

        {/* Global Inventory Alert if low */}
        {errors.inventory && (
          <div className="max-w-2xl mb-6 p-4 rounded-xl bg-rose-950/60 border border-rose-500 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errors.inventory}</span>
          </div>
        )}

        {/* Checkout Card */}
        <div className="bg-[#0d1522] border border-white/10 rounded-2xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Order Summary & Quantity (5 cols) */}
          <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-white/10 pb-6 lg:pb-0 lg:pr-8 flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Order Summary
              </span>
              <h3 className="text-xl font-bold text-white font-display">
                {tierInfo.name} Ticket
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Friday, 11 December 2026 · Prince Resort Bunamwaya
              </p>

              {/* Perks list */}
              <div className="mt-5 space-y-2.5 text-xs text-slate-300">
                {tierInfo.perks.map((perk, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{perk}</span>
                  </div>
                ))}
              </div>

              {/* Quantity Picker */}
              <div className="mt-8 pt-6 border-t border-white/10">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                  Select Quantity
                </label>
                <div className="flex items-center justify-between bg-[#080c14] rounded-xl p-2 border border-white/10">
                  <button
                    type="button"
                    onClick={() => handleQuantityChange(-1)}
                    disabled={quantity <= 1}
                    className="w-10 h-10 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className="text-center">
                    <span className="text-2xl font-bold text-white font-mono tabular-nums">
                      {quantity}
                    </span>
                    <span className="block text-[10px] text-slate-400 uppercase">
                      {quantity === 1 ? 'Pass' : 'Passes'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleQuantityChange(1)}
                    disabled={quantity >= Math.min(10, remainingInventory)}
                    className="w-10 h-10 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Price Calculation */}
            <div className="mt-8 pt-6 border-t border-white/10 bg-[#080c14] p-4 rounded-xl border border-white/5">
              <div className="space-y-1 text-xs text-slate-300">
                <div className="flex justify-between">
                  <span>Unit Price</span>
                  <span className="font-mono text-white tabular-nums">UGX {unitPrice.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Quantity</span>
                  <span className="font-mono text-white tabular-nums">× {quantity}</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-white/10 flex justify-between items-baseline">
                <span className="text-xs uppercase font-bold text-slate-300">Total Due</span>
                <span className="text-2xl font-black text-amber-300 font-mono tabular-nums">
                  UGX {totalPrice.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Attendee Form & Mobile Money Provider (7 cols) */}
          <div className="lg:col-span-7 flex flex-col justify-between">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <h4 className="text-base font-bold text-white">
                  Attendee & Mobile Money Details
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Your personalized Canva ticket and verification QR code will be generated upon payment.
                </p>
              </div>

              {/* Full Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Full Name <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  placeholder="e.g. Joel Mukisa"
                  className={`w-full px-4 py-2.5 rounded-lg bg-[#080c14] border text-white text-sm focus:outline-none focus:border-amber-400 transition-colors ${
                    errors.fullName ? 'border-rose-500' : 'border-white/15'
                  }`}
                />
                {errors.fullName && <p className="text-xs text-rose-400 mt-1">{errors.fullName}</p>}
              </div>

              {/* Email Address */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Email Address <span className="text-amber-400">*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="joel@example.ug"
                  className={`w-full px-4 py-2.5 rounded-lg bg-[#080c14] border text-white text-sm focus:outline-none focus:border-amber-400 transition-colors ${
                    errors.email ? 'border-rose-500' : 'border-white/15'
                  }`}
                />
                {errors.email && <p className="text-xs text-rose-400 mt-1">{errors.email}</p>}
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Uganda Mobile Money Phone Number <span className="text-amber-400">*</span>
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0775 198 484 or +256 701 234567"
                  className={`w-full px-4 py-2.5 rounded-lg bg-[#080c14] border text-white text-sm focus:outline-none focus:border-amber-400 transition-colors ${
                    errors.phone ? 'border-rose-500' : 'border-white/15'
                  }`}
                />
                {errors.phone && <p className="text-xs text-rose-400 mt-1">{errors.phone}</p>}
                <p className="text-[11px] text-slate-400 mt-1">
                  An official Relworx payment prompt will be pushed directly to this handset.
                </p>
              </div>

              {/* Mobile Money Operator Selection */}
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Select Mobile Money Network
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNetwork('MTN')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-colors flex items-center gap-3 ${
                      network === 'MTN'
                        ? 'bg-[#121c2e] border-amber-400 text-white'
                        : 'bg-[#080c14] border-white/10 text-slate-400 hover:border-white/20'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-amber-400 text-slate-950 font-black flex items-center justify-center text-xs shrink-0 font-mono">
                      MTN
                    </div>
                    <div>
                      <span className="block text-xs font-bold text-white">MTN MoMo</span>
                      <span className="text-[10px] text-slate-400">*165# PIN Prompt</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNetwork('AIRTEL')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-colors flex items-center gap-3 ${
                      network === 'AIRTEL'
                        ? 'bg-[#121c2e] border-rose-400 text-white'
                        : 'bg-[#080c14] border-white/10 text-slate-400 hover:border-white/20'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-rose-600 text-white font-black flex items-center justify-center text-xs shrink-0 font-mono">
                      AIR
                    </div>
                    <div>
                      <span className="block text-xs font-bold text-white">Airtel Money</span>
                      <span className="text-[10px] text-slate-400">*185# PIN Prompt</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Submit CTA */}
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting || remainingInventory < quantity}
                  className="w-full py-3.5 text-xs font-bold tracking-wider text-slate-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 disabled:opacity-50 transition-colors rounded-lg shadow-sm whitespace-nowrap cursor-pointer uppercase flex items-center justify-center gap-2 font-display"
                >
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Locking Inventory & Initiating...</span>
                    </div>
                  ) : (
                    <>
                      <span>Pay via {network} MoMo · UGX {totalPrice.toLocaleString()}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 mt-3">
                  <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>10-Minute Reservation Lock · Relworx Uganda Mobile Money</span>
                </div>
              </div>
            </form>
          </div>

        </div>

      </div>

      {/* Relworx Checkout Modal */}
      {checkoutModal && (
        <RelworxPaymentModal
          orderRef={checkoutModal.orderRef}
          initialMessage={checkoutModal.message}
          reservedUntil={checkoutModal.reservedUntil}
          totalAmountUgx={checkoutModal.totalAmountUgx}
          buyerName={checkoutModal.buyerName}
          buyerPhone={checkoutModal.buyerPhone}
          network={checkoutModal.network}
          onClose={() => {
            setCheckoutModal(null);
            refreshCounts();
          }}
          onPaymentSuccess={() => {
            refreshCounts();
          }}
        />
      )}

      {/* Attendee Ticket Self-Service Retrieval Modal */}
      <TicketLookupModal
        isOpen={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelectTicket={(ticket) => onContinueToPayment(ticket)}
      />
    </section>
  );
};
