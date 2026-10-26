import React, { useState } from 'react';
import { 
  Ticket, 
  Minus, 
  Plus, 
  CreditCard, 
  Smartphone, 
  CheckCircle2, 
  AlertCircle, 
  Crown,
  Sparkles,
  ArrowRight,
  Phone
} from 'lucide-react';
import { EVENT_DATA, TICKET_TIERS, TicketTier, PaymentMethod, BuyerForm, ReservationOrder } from '../types/event';

interface TicketPurchaseProps {
  onContinueToPayment: (order: ReservationOrder) => void;
}

export const TicketPurchase: React.FC<TicketPurchaseProps> = ({ onContinueToPayment }) => {
  const [selectedTier, setSelectedTier] = useState<TicketTier>('ordinary');
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

  const tierInfo = TICKET_TIERS[selectedTier];
  const unitPrice = tierInfo.priceUgx;
  const totalPrice = unitPrice * quantity;

  const handleTierChange = (tier: TicketTier) => {
    setSelectedTier(tier);
  };

  const handleQuantityChange = (delta: number) => {
    const next = quantity + delta;
    if (next >= 1 && next <= 10) {
      setQuantity(next);
    }
  };

  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};

    if (!form.fullName.trim() || form.fullName.trim().length < 3) {
      errs.fullName = 'Please enter your full name.';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.email.trim() || !emailRegex.test(form.email)) {
      errs.email = 'Please provide a valid email address.';
    }

    const cleanedPhone = form.phone.replace(/[\s-]/g, '');
    if (!cleanedPhone || cleanedPhone.length < 9) {
      errs.phone = 'Please provide a valid phone number (e.g. 0775 198 484).';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      const randomRef = Math.floor(10000 + Math.random() * 90000);
      const order: ReservationOrder = {
        orderId: `PP26-UG-${randomRef}`,
        timestamp: new Date().toISOString(),
        buyerName: form.fullName.trim(),
        buyerEmail: form.email.trim(),
        buyerPhone: form.phone.trim(),
        tier: selectedTier,
        tierName: tierInfo.name,
        quantity,
        unitPrice,
        totalPrice,
        paymentMethod: form.paymentMethod,
        status: 'integration_sandbox',
      };
      onContinueToPayment(order);
    }, 350);
  };

  return (
    <section id="tickets" className="py-20 bg-[#030712] relative border-t border-amber-500/20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-xl mx-auto mb-12">
          <div className="text-xs font-bold tracking-widest text-amber-400 uppercase mb-1">
            Official Ticket Booking
          </div>
          <h2 className="text-3xl sm:text-5xl font-black text-white font-display">
            Select Your Pass
          </h2>
          <p className="text-slate-400 text-sm mt-2">
            Ordinary (UGX 20,000) or VIP (UGX 50,000). Instant digital ticket delivery.
          </p>
        </div>

        {/* Tier Selector Tabs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto mb-10">
          
          {/* Ordinary Tier Button */}
          <button
            type="button"
            onClick={() => handleTierChange('ordinary')}
            className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer relative ${
              selectedTier === 'ordinary'
                ? 'bg-[#0b1b36] border-amber-400 shadow-lg shadow-amber-500/15'
                : 'bg-[#070e1b] border-white/10 hover:border-white/20 opacity-80 hover:opacity-100'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                General Pool Entry
              </span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-amber-400 text-slate-950">
                20K
              </span>
            </div>
            <div className="text-2xl font-black text-white font-display">
              Ordinary Pass
            </div>
            <div className="text-xl font-bold text-amber-400 font-mono mt-1">
              UGX 20,000
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Full pool access, Live DJ sets, Swimwear contest & party games.
            </p>
          </button>

          {/* VIP Tier Button */}
          <button
            type="button"
            onClick={() => handleTierChange('vip')}
            className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer relative ${
              selectedTier === 'vip'
                ? 'bg-[#0b1b36] border-cyan-400 shadow-lg shadow-cyan-500/15'
                : 'bg-[#070e1b] border-white/10 hover:border-white/20 opacity-80 hover:opacity-100'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1">
                <Crown className="w-3.5 h-3.5" />
                <span>VIP Experience</span>
              </span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-cyan-400 text-slate-950">
                50K
              </span>
            </div>
            <div className="text-2xl font-black text-white font-display">
              VIP Pass
            </div>
            <div className="text-xl font-bold text-cyan-300 font-mono mt-1">
              UGX 50,000
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Fast-track gate, reserved poolside cabana zone & welcome skewer/drink.
            </p>
          </button>

        </div>

        {/* The Checkout Card */}
        <div className="bg-[#070e1b] border border-amber-400/30 rounded-3xl p-6 sm:p-10 shadow-2xl grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Order Summary & Quantity (5 cols) */}
          <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-white/10 pb-6 lg:pb-0 lg:pr-8 flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block mb-1">
                Your Order
              </span>
              <h3 className="text-2xl font-bold text-white font-display">
                {tierInfo.name} Ticket
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Friday, December 11th 2026 · Prince Resort Bunamwaya Bella
              </p>

              {/* Perks list */}
              <div className="mt-5 space-y-2 text-xs text-slate-300">
                {tierInfo.perks.map((perk, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>{perk}</span>
                  </div>
                ))}
              </div>

              {/* Quantity Picker */}
              <div className="mt-8 pt-6 border-t border-white/10">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                  Quantity
                </label>
                <div className="flex items-center justify-between bg-[#030712] rounded-xl p-2 border border-white/10">
                  <button
                    type="button"
                    onClick={() => handleQuantityChange(-1)}
                    disabled={quantity <= 1}
                    className="w-10 h-10 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white flex items-center justify-center cursor-pointer"
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
                    disabled={quantity >= 10}
                    className="w-10 h-10 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Price Calculation */}
            <div className="mt-8 pt-6 border-t border-white/10 bg-[#030712]/60 p-4 rounded-xl">
              <div className="space-y-1 text-xs text-slate-300">
                <div className="flex justify-between">
                  <span>Price per ticket</span>
                  <span className="font-mono text-white">UGX {unitPrice.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Quantity</span>
                  <span className="font-mono text-white">× {quantity}</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-white/10 flex justify-between items-baseline">
                <span className="text-xs uppercase font-bold text-slate-200">Total Price</span>
                <span className="text-2xl font-black text-amber-300 font-mono tabular-nums">
                  UGX {totalPrice.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Attendee Form & Payment Method (7 cols) */}
          <div className="lg:col-span-7 flex flex-col justify-between">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <h4 className="text-lg font-bold text-white">
                  Attendee Details
                </h4>
                <p className="text-xs text-slate-400">
                  Where should we send your official entry QR ticket?
                </p>
              </div>

              {/* Full Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  placeholder="e.g. Joel Mukisa"
                  className={`w-full px-4 py-2.5 rounded-xl bg-[#030712] border text-white text-sm focus:outline-none focus:ring-1 ${
                    errors.fullName ? 'border-rose-500 focus:ring-rose-500' : 'border-white/15 focus:border-amber-400 focus:ring-amber-400'
                  }`}
                />
                {errors.fullName && <p className="text-xs text-rose-400 mt-1">{errors.fullName}</p>}
              </div>

              {/* Email Address */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="joel@example.com"
                  className={`w-full px-4 py-2.5 rounded-xl bg-[#030712] border text-white text-sm focus:outline-none focus:ring-1 ${
                    errors.email ? 'border-rose-500 focus:ring-rose-500' : 'border-white/15 focus:border-amber-400 focus:ring-amber-400'
                  }`}
                />
                {errors.email && <p className="text-xs text-rose-400 mt-1">{errors.email}</p>}
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Phone Number (for SMS ticket & Mobile Money)
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0775 000 000 or +256 700 000 000"
                  className={`w-full px-4 py-2.5 rounded-xl bg-[#030712] border text-white text-sm focus:outline-none focus:ring-1 ${
                    errors.phone ? 'border-rose-500 focus:ring-rose-500' : 'border-white/15 focus:border-amber-400 focus:ring-amber-400'
                  }`}
                />
                {errors.phone && <p className="text-xs text-rose-400 mt-1">{errors.phone}</p>}
              </div>

              {/* Payment Provider Selection */}
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Payment Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, paymentMethod: 'mtn_momo' })}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      form.paymentMethod === 'mtn_momo'
                        ? 'bg-amber-950/40 border-amber-400 text-white font-bold'
                        : 'bg-[#030712] border-white/10 text-slate-400'
                    }`}
                  >
                    <Smartphone className="w-4 h-4 text-amber-400 mb-1" />
                    <span className="block text-xs">MTN MoMo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, paymentMethod: 'airtel_money' })}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      form.paymentMethod === 'airtel_money'
                        ? 'bg-red-950/40 border-red-400 text-white font-bold'
                        : 'bg-[#030712] border-white/10 text-slate-400'
                    }`}
                  >
                    <Smartphone className="w-4 h-4 text-red-400 mb-1" />
                    <span className="block text-xs">Airtel Money</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, paymentMethod: 'card' })}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      form.paymentMethod === 'card'
                        ? 'bg-cyan-950/40 border-cyan-400 text-white font-bold'
                        : 'bg-[#030712] border-white/10 text-slate-400'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-cyan-400 mb-1" />
                    <span className="block text-xs">Card / Visa</span>
                  </button>
                </div>
              </div>

              {/* Submit CTA */}
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-4 text-sm font-black tracking-wider text-slate-950 bg-gradient-to-r from-amber-400 via-amber-300 to-cyan-400 hover:from-amber-300 hover:to-cyan-300 disabled:opacity-50 transition-all rounded-xl shadow-lg shadow-amber-500/20 active:scale-98 whitespace-nowrap cursor-pointer uppercase flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <span>PREPARING...</span>
                  ) : (
                    <>
                      <span>CONTINUE TO PAYMENT · UGX {totalPrice.toLocaleString()}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <p className="text-[11px] text-center text-slate-400 mt-2">
                  Sandbox demo mode · No live money debited · RSVP Inquiries: {EVENT_DATA.rsvpPhone}
                </p>
              </div>
            </form>
          </div>

        </div>

      </div>
    </section>
  );
};
