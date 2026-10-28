import React, { useState, useEffect, useRef } from 'react';
import { 
  Minus, 
  Plus, 
  CheckCircle2, 
  AlertCircle, 
  Crown,
  ArrowRight,
  Search,
  RefreshCw,
  Clock,
  X
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { TICKET_TIERS, TicketTier, BuyerForm } from '../types/event';
import { TicketService } from '../lib/ticketService';
import { TicketRecord, PublicInventoryCounts } from '../types/inventory';
import { MtnMerchantPaymentModal } from './payment/MtnMerchantPaymentModal';
import { TicketLookupModal } from './ticket/TicketLookupModal';
import { PoolPartyLogo } from './brand/PoolPartyLogo';

interface TicketPurchaseProps {
  onContinueToPayment: (ticket: TicketRecord) => void;
  selectedTierProp?: TicketTier | null;
}

export const TicketPurchase: React.FC<TicketPurchaseProps> = ({ 
  onContinueToPayment,
  selectedTierProp
}) => {
  const [selectedTier, setSelectedTier] = useState<TicketTier | null>(selectedTierProp ?? null);
  const [quantity, setQuantity] = useState<number>(1);
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
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [countsError, setCountsError] = useState<string | null>(null);

  const checkoutSectionRef = useRef<HTMLDivElement | null>(null);
  const shouldReduceMotion = useReducedMotion();

  // MTN Merchant Configuration
  const [mtnConfig, setMtnConfig] = useState<{
    configured: boolean;
    merchantCode?: string;
    merchantName?: string;
    warning?: string;
    instructions?: {
      ussdCode: string;
      ussdDialUrl?: string;
      steps: string[];
    };
  } | null>(null);

  // MTN MoMo Merchant Checkout Modal State
  const [mtnModal, setMtnModal] = useState<{
    orderRef: string;
    message?: string;
    reservedUntil?: string | null;
    totalAmountUgx?: number;
    buyerName?: string;
    buyerPhone?: string;
    buyerEmail?: string;
    category?: 'VIP' | 'ORDINARY';
    quantity?: number;
    merchantCode?: string;
    merchantName?: string;
    isConfigured?: boolean;
  } | null>(null);

  // Ticket Lookup Modal State
  const [lookupOpen, setLookupOpen] = useState(false);

  const refreshCounts = async () => {
    setLoadingCounts(true);
    setCountsError(null);
    const res = await TicketService.getPublicCounts();
    if (res.success && res.counts) {
      setPublicCounts(res.counts);
      setCountsError(null);
    } else {
      setCountsError(res.error || 'Unable to connect to live database.');
      setPublicCounts(null);
    }
    setLoadingCounts(false);
  };

  useEffect(() => {
    refreshCounts();
    TicketService.getMtnConfig().then(setMtnConfig);
  }, []);

  useEffect(() => {
    if (selectedTierProp) {
      setSelectedTier(selectedTierProp);
      setForm((prev) => ({ ...prev, tier: selectedTierProp }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next.inventory;
        return next;
      });
      window.setTimeout(() => {
        checkoutSectionRef.current?.scrollIntoView({
          behavior: shouldReduceMotion ? 'auto' : 'smooth',
          block: 'nearest',
        });
      }, 150);
    }
  }, [selectedTierProp, shouldReduceMotion]);

  const activeTier: TicketTier = selectedTier ?? 'ordinary';
  const tierInfo = TICKET_TIERS[activeTier];
  const unitPrice = tierInfo.priceUgx;
  const totalPrice = unitPrice * quantity;

  // Remaining inventory strictly from Supabase records when loaded
  const remainingInventory = publicCounts
    ? activeTier === 'vip'
      ? publicCounts.VIP.available
      : publicCounts.ORDINARY.available
    : null;

  const isTierSoldOut = remainingInventory !== null && remainingInventory <= 0;

  const handleTierChange = (tier: TicketTier) => {
    const wasClosed = selectedTier === null;
    if (selectedTier === tier) {
      setSelectedTier(null);
      return;
    }

    setSelectedTier(tier);
    setForm((prev) => ({ ...prev, tier }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.inventory;
      return next;
    });
    if (publicCounts) {
      const tierAvailable = tier === 'vip' ? publicCounts.VIP.available : publicCounts.ORDINARY.available;
      if (tierAvailable > 0 && quantity > tierAvailable) {
        setQuantity(Math.min(10, tierAvailable));
      }
    }

    if (wasClosed) {
      window.setTimeout(() => {
        checkoutSectionRef.current?.scrollIntoView({
          behavior: shouldReduceMotion ? 'auto' : 'smooth',
          block: 'nearest',
        });
      }, 120);
    }
  };

  const handleQuantityChange = (delta: number) => {
    const next = quantity + delta;
    const maxAllowed =
      remainingInventory !== null && remainingInventory > 0 ? Math.min(10, remainingInventory) : 10;
    if (next >= 1 && next <= maxAllowed) {
      setQuantity(next);
    }
  };

  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};

    if (!form.fullName.trim() || form.fullName.trim().length < 2) {
      errs.fullName = 'Please enter your full name as it will appear on your pass.';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.email.trim() || !emailRegex.test(form.email.trim())) {
      errs.email = 'Please provide a valid email address.';
    }

    let cleanedPhone = form.phone.replace(/[\s\-\(\)]/g, '');
    if (cleanedPhone.startsWith('+256')) cleanedPhone = cleanedPhone.substring(4);
    else if (cleanedPhone.startsWith('256')) cleanedPhone = cleanedPhone.substring(3);
    else if (cleanedPhone.startsWith('0')) cleanedPhone = cleanedPhone.substring(1);

    if (!/^[73][0-9]{8}$/.test(cleanedPhone)) {
      errs.phone = 'Please provide a valid Uganda MTN Mobile Money phone number (e.g. 0775 198 484).';
    }

    if (remainingInventory !== null && remainingInventory < quantity) {
      errs.inventory =
        remainingInventory === 0
          ? `${activeTier.toUpperCase()} passes are currently sold out.`
          : `Only ${remainingInventory} ${activeTier.toUpperCase()} pass(es) remaining in stock.`;
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTier || isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      const res = await TicketService.initiateMtnPayment({
        category: activeTier === 'vip' ? 'VIP' : 'ORDINARY',
        quantity,
        buyerName: form.fullName.trim(),
        buyerEmail: form.email.trim(),
        buyerPhone: form.phone.trim(),
      });

      if (!res.success || !res.orderRef) {
        setErrors({
          inventory: res.message || 'Payment initiation failed. Please try again.',
        });
        return;
      }

      // Refresh stock counts from database in background
      void refreshCounts();

      // Open MTN Merchant payment modal
      setMtnModal({
        orderRef: res.orderRef,
        message: res.message,
        reservedUntil: res.reservedUntil,
        totalAmountUgx: res.totalAmountUgx || totalPrice,
        category: activeTier === 'vip' ? 'VIP' : 'ORDINARY',
        quantity,
        buyerName: form.fullName.trim(),
        buyerPhone: form.phone.trim(),
        buyerEmail: form.email.trim(),
        merchantCode: res.merchantCode || mtnConfig?.merchantCode,
        merchantName: res.merchantName || mtnConfig?.merchantName,
        isConfigured: res.isConfigured !== false && mtnConfig?.configured !== false,
      });
    } catch {
      setErrors({
        inventory: 'Unable to submit your reservation right now. Please check your connection and try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section id="tickets" className="py-12 sm:py-20 bg-[#080c14] relative border-b border-white/10">
      <div className="max-w-6xl mx-auto px-3.5 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="max-w-2xl mb-8 sm:mb-10">
          <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs font-semibold text-slate-400 mb-2">
            <PoolPartyLogo variant="icon" size="sm" />
            <span className="text-amber-400 font-bold uppercase tracking-wider">Official Ticketing</span>
            <span aria-hidden="true">·</span>
            <span>Capacity strictly limited to 70 total passes</span>
          </div>
          <h2 className="text-2xl xs:text-3xl sm:text-4xl font-black text-white font-display">
            Select Your Pool Pass
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-2">
            Choose an Ordinary Pass (UGX 20,000) or VIP Pass (UGX 50,000) below to unlock MTN Mobile Money checkout.
          </p>

          <div className="mt-3">
            <button
              onClick={() => setLookupOpen(true)}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1.5 cursor-pointer py-1"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Already purchased? Retrieve & download your tickets</span>
            </button>
          </div>
        </div>

        {/* Tier Selector Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4 max-w-2xl mb-6 sm:mb-8">
          
          {/* Ordinary Tier Button */}
          <motion.button
            type="button"
            onClick={() => handleTierChange('ordinary')}
            aria-pressed={selectedTier === 'ordinary'}
            aria-expanded={selectedTier === 'ordinary'}
            whileHover={shouldReduceMotion ? undefined : { y: -3 }}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className={`p-3.5 sm:p-5 rounded-xl border text-left transition-colors cursor-pointer relative overflow-hidden group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
              selectedTier === 'ordinary'
                ? 'bg-[#0d1522] border-amber-400/80 shadow-lg shadow-amber-500/10'
                : 'bg-[#0d1522]/60 border-white/10 hover:border-amber-400/40 hover:bg-[#0d1522]'
            }`}
          >
            {selectedTier === 'ordinary' && (
              <motion.div
                layoutId="selected-pass-highlight"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="pointer-events-none absolute inset-0 rounded-xl border-2 border-amber-400 bg-amber-400/[0.03]"
              />
            )}

            <div className="relative z-10">
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
                  {loadingCounts ? (
                    <span className="text-slate-400 animate-pulse">Loading...</span>
                  ) : publicCounts ? (
                    `${publicCounts.ORDINARY.available} / ${publicCounts.ORDINARY.total} Remaining`
                  ) : (
                    <span className="text-amber-400">Database offline</span>
                  )}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs font-semibold">
                <span className={selectedTier === 'ordinary' ? 'text-amber-400' : 'text-slate-400 group-hover:text-amber-300 transition-colors'}>
                  {selectedTier === 'ordinary' ? 'Selected · Payment options below' : 'Select to continue to payment'}
                </span>
                <ArrowRight
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    selectedTier === 'ordinary'
                      ? 'text-amber-400 rotate-90'
                      : 'text-slate-500 group-hover:text-amber-300 group-hover:translate-x-0.5'
                  }`}
                />
              </div>
            </div>
          </motion.button>

          {/* VIP Tier Button */}
          <motion.button
            type="button"
            onClick={() => handleTierChange('vip')}
            aria-pressed={selectedTier === 'vip'}
            aria-expanded={selectedTier === 'vip'}
            whileHover={shouldReduceMotion ? undefined : { y: -3 }}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className={`p-3.5 sm:p-5 rounded-xl border text-left transition-colors cursor-pointer relative overflow-hidden group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              selectedTier === 'vip'
                ? 'bg-[#0d1522] border-cyan-400/80 shadow-lg shadow-cyan-500/10'
                : 'bg-[#0d1522]/60 border-white/10 hover:border-cyan-400/40 hover:bg-[#0d1522]'
            }`}
          >
            {selectedTier === 'vip' && (
              <motion.div
                layoutId="selected-pass-highlight"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="pointer-events-none absolute inset-0 rounded-xl border-2 border-cyan-400 bg-cyan-400/[0.03]"
              />
            )}

            <div className="relative z-10">
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
                  {loadingCounts ? (
                    <span className="text-slate-400 animate-pulse">Loading...</span>
                  ) : publicCounts ? (
                    `${publicCounts.VIP.available} / ${publicCounts.VIP.total} Remaining`
                  ) : (
                    <span className="text-amber-400">Database offline</span>
                  )}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs font-semibold">
                <span className={selectedTier === 'vip' ? 'text-cyan-300' : 'text-slate-400 group-hover:text-cyan-300 transition-colors'}>
                  {selectedTier === 'vip' ? 'Selected · Payment options below' : 'Select to continue to payment'}
                </span>
                <ArrowRight
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    selectedTier === 'vip'
                      ? 'text-cyan-300 rotate-90'
                      : 'text-slate-500 group-hover:text-cyan-300 group-hover:translate-x-0.5'
                  }`}
                />
              </div>
            </div>
          </motion.button>

        </div>

        {/* Database Offline Error Banner */}
        {countsError && (
          <div className="max-w-2xl mb-6 p-3.5 sm:p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{countsError}</span>
            </div>
            <button
              type="button"
              onClick={refreshCounts}
              className="px-2.5 py-1 bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 rounded font-semibold text-[11px] cursor-pointer inline-flex items-center gap-1 min-h-[36px]"
            >
              <RefreshCw className={`w-3 h-3 ${loadingCounts ? 'animate-spin' : ''}`} />
              <span>Retry</span>
            </button>
          </div>
        )}


        {errors.inventory && (
          <div className="max-w-2xl mb-6 p-3.5 sm:p-4 rounded-xl bg-rose-950/60 border border-rose-500 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errors.inventory}</span>
          </div>
        )}

        {/* Animated Checkout & Payment Card — Appears Only When a Pass Tier Is Clicked */}
        <AnimatePresence initial={false}>
          {selectedTier !== null && (
            <motion.div
              key="checkout-payment-panel"
              ref={checkoutSectionRef}
              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.985 }}
              transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
              className={`bg-[#0d1522] border rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 relative ${
                selectedTier === 'vip' ? 'border-cyan-400/30' : 'border-amber-400/30'
              }`}
            >
              {/* Collapse / Change Selection Action */}
              <button
                type="button"
                onClick={() => setSelectedTier(null)}
                aria-label="Close payment options"
                className="absolute top-3.5 right-3.5 sm:top-5 sm:right-5 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
              >
                <span>Close</span>
                <X className="w-3.5 h-3.5" />
              </button>

              {/* Order Summary & Quantity (5 cols) */}
              <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-white/10 pb-6 lg:pb-0 lg:pr-8 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Order Summary
                  </span>

                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={activeTier}
                      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 10 }}
                      transition={{ duration: 0.22, ease: 'easeOut' }}
                    >
                      <h3 className="text-lg sm:text-xl font-bold text-white font-display pr-14 sm:pr-0">
                        {tierInfo.name} Ticket
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Friday, 11 December 2026 · Prince Resort Bunamwaya
                      </p>

                      {/* Perks list */}
                      <div className="mt-4 sm:mt-5 space-y-2 text-xs text-slate-300">
                        {tierInfo.perks.map((perk, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <CheckCircle2
                              className={`w-3.5 h-3.5 shrink-0 ${
                                activeTier === 'vip' ? 'text-cyan-400' : 'text-amber-400'
                              }`}
                            />
                            <span>{perk}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  </AnimatePresence>

                  {/* Quantity Picker */}
                  <div className="mt-6 sm:mt-8 pt-5 sm:pt-6 border-t border-white/10">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                      Select Quantity
                    </label>
                    <div className="flex items-center justify-between bg-[#080c14] rounded-xl p-2 border border-white/10">
                      <button
                        type="button"
                        onClick={() => handleQuantityChange(-1)}
                        disabled={quantity <= 1}
                        className="w-11 h-11 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white flex items-center justify-center cursor-pointer transition-colors"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <div className="text-center px-2">
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
                        disabled={
                          quantity >=
                          (remainingInventory !== null && remainingInventory > 0
                            ? Math.min(10, remainingInventory)
                            : 10)
                        }
                        className="w-11 h-11 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white flex items-center justify-center cursor-pointer disabled:cursor-not-allowed transition-colors"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Price Calculation */}
                <div className="mt-6 sm:mt-8 pt-5 sm:pt-6 border-t border-white/10 bg-[#080c14] p-3.5 sm:p-4 rounded-xl border border-white/5">
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
                    <span
                      className={`text-xl sm:text-2xl font-black font-mono tabular-nums ${
                        activeTier === 'vip' ? 'text-cyan-300' : 'text-amber-300'
                      }`}
                    >
                      UGX {totalPrice.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Attendee Form & Mobile Money Provider (7 cols) */}
              <div className="lg:col-span-7 flex flex-col justify-between">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="pr-16 sm:pr-20">
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
                      className={`w-full px-3.5 sm:px-4 py-3 sm:py-2.5 rounded-lg bg-[#080c14] border text-white text-base sm:text-sm min-h-[46px] focus:outline-none focus:border-amber-400 transition-colors ${
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
                      className={`w-full px-3.5 sm:px-4 py-3 sm:py-2.5 rounded-lg bg-[#080c14] border text-white text-base sm:text-sm min-h-[46px] focus:outline-none focus:border-amber-400 transition-colors ${
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
                      className={`w-full px-3.5 sm:px-4 py-3 sm:py-2.5 rounded-lg bg-[#080c14] border text-white text-base sm:text-sm min-h-[46px] focus:outline-none focus:border-amber-400 transition-colors ${
                        errors.phone ? 'border-rose-500' : 'border-white/15'
                      }`}
                    />
                    {errors.phone && <p className="text-xs text-rose-400 mt-1">{errors.phone}</p>}
                    <p className="text-[11px] text-slate-400 mt-1">
                      Used for your pass reservation and payment verification matching.
                    </p>
                  </div>

                  {/* MTN Mobile Money Payment Method Card */}
                  <motion.div
                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08, duration: 0.3, ease: 'easeOut' }}
                    className="pt-2"
                  >
                    <label className="block text-xs font-semibold text-slate-300 mb-2">
                      Payment Method
                    </label>
                    
                    <div className="p-3.5 sm:p-4 rounded-xl border border-amber-400/50 bg-[#121c2e]/90 text-white relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/5 rounded-full blur-2xl pointer-events-none" />

                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#FFCC00] text-black font-black flex flex-col items-center justify-center shrink-0 shadow-md">
                          <span className="text-[11px] sm:text-[12px] leading-tight font-black tracking-tight">MTN</span>
                          <span className="text-[8.5px] sm:text-[9px] font-bold tracking-tighter uppercase">MoMo</span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <span className="text-xs sm:text-sm font-bold text-white">MTN Mobile Money Merchant Payment</span>
                            <span className="text-[10px] sm:text-[11px] font-semibold text-amber-300">
                              · MoMoPay / USSD
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                            Pay securely using MTN MoMo merchant code and enter your transaction ID to verify your pass.
                          </p>

                          {/* Config Status */}
                          {mtnConfig && !mtnConfig.configured && (
                            <div className="mt-2.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-semibold block">Merchant Code Not Yet Configured</span>
                                <span className="text-amber-200/80 text-[11px]">
                                  Set <code className="font-mono bg-black/40 px-1 py-0.5 rounded text-amber-300">MTN_MERCHANT_CODE</code> in your server environment to display the live merchant code.
                                </span>
                              </div>
                            </div>
                          )}

                          {mtnConfig?.configured && (
                            <div className="mt-2.5 p-2.5 rounded-lg bg-[#080c14]/80 border border-white/10 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-xs">
                                <span className="text-slate-400 block text-[10px] uppercase font-mono">Merchant Code</span>
                                <span className="font-mono font-bold text-amber-300 text-sm tracking-wider">
                                  {mtnConfig.merchantCode}
                                </span>
                                {mtnConfig.merchantName && (
                                  <span className="text-slate-400 text-[11px] block">({mtnConfig.merchantName})</span>
                                )}
                              </div>
                              <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-2 py-1 rounded">
                                Dial *165*3#
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-3.5 pt-3 border-t border-white/10 text-[11px] text-slate-300 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Your pass is held for 15 minutes while you complete payment and submit your transaction ID.</span>
                      </div>
                    </div>
                  </motion.div>

                  {errors.inventory && (
                    <div
                      role="alert"
                      className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/70 text-rose-200 text-xs flex items-start gap-2.5"
                    >
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{errors.inventory}</span>
                    </div>
                  )}

                  {/* Submit CTA */}
                  <div className="pt-2">
                    <motion.button
                      type="submit"
                      disabled={isSubmitting || isTierSoldOut}
                      whileHover={shouldReduceMotion || isSubmitting || isTierSoldOut ? undefined : { scale: 1.01 }}
                      whileTap={shouldReduceMotion || isSubmitting || isTierSoldOut ? undefined : { scale: 0.985 }}
                      transition={{ type: 'spring', stiffness: 450, damping: 26 }}
                      className="w-full min-h-[48px] py-3.5 px-4 text-xs font-bold tracking-wider text-slate-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-lg shadow-sm cursor-pointer uppercase flex items-center justify-center gap-2 font-display text-center leading-snug"
                    >
                      {isSubmitting ? (
                        <div className="flex items-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                          <span>Locking Pass & Generating Reference...</span>
                        </div>
                      ) : isTierSoldOut ? (
                        <span>{activeTier.toUpperCase()} Passes Sold Out</span>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          <span>Reserve Passes & Pay with MTN MoMo · UGX {totalPrice.toLocaleString()}</span>
                          <ArrowRight className="w-4 h-4 shrink-0" />
                        </div>
                      )}
                    </motion.button>

                    <div className="flex items-center justify-center gap-2 text-[10.5px] sm:text-[11px] text-slate-400 mt-3 text-center">
                      <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>15-Minute Reservation Lock · Verified & Issued by Event Admin</span>
                    </div>
                  </div>
                </form>
              </div>

            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* MTN MoMo Merchant Payment & Submission Modal */}
      {mtnModal && (
        <MtnMerchantPaymentModal
          orderRef={mtnModal.orderRef}
          initialMessage={mtnModal.message}
          reservedUntil={mtnModal.reservedUntil}
          totalAmountUgx={mtnModal.totalAmountUgx}
          buyerName={mtnModal.buyerName}
          buyerPhone={mtnModal.buyerPhone}
          buyerEmail={mtnModal.buyerEmail}
          category={mtnModal.category}
          quantity={mtnModal.quantity}
          merchantCode={mtnModal.merchantCode}
          merchantName={mtnModal.merchantName}
          ussdCode={mtnConfig?.instructions?.ussdCode}
          isConfigured={mtnModal.isConfigured}
          onClose={() => {
            setMtnModal(null);
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
