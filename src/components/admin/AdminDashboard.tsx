import React, { useState, useEffect } from 'react';
import { 
  Lock, 
  Crown, 
  Ticket, 
  CheckCircle2, 
  Clock, 
  Plus, 
  Printer, 
  Search, 
  ShieldCheck, 
  RefreshCw, 
  DollarSign, 
  ArrowLeft, 
  Database, 
  Copy, 
  Check, 
  ExternalLink, 
  XCircle, 
  QrCode,
  Smartphone,
  AlertCircle
} from 'lucide-react';
import { TicketService } from '../../lib/ticketService';
import { TicketRenderer } from '../../lib/ticketRenderer';
import { TicketRecord, InventoryDashboardStats, TicketCategory } from '../../types/inventory';
import { SUPABASE_CONFIG } from '../../lib/supabase';

interface AdminDashboardProps {
  onBack: () => void;
  onOpenGateScanner: () => void;
  onViewTicket: (ticket: TicketRecord) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
  onBack, 
  onOpenGateScanner, 
  onViewTicket 
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [authError, setAuthError] = useState('');

  const [stats, setStats] = useState<InventoryDashboardStats | null>(null);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'VIP' | 'ORDINARY'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'reserved' | 'issued' | 'paid'>('all');

  const [activeTab, setActiveTab] = useState<'inventory' | 'mtn_payments' | 'orders' | 'physical_sale' | 'setup_guide'>('mtn_payments');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmReleaseId, setConfirmReleaseId] = useState<string | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [verifyingOrderRef, setVerifyingOrderRef] = useState<string | null>(null);
  const [healthData, setHealthData] = useState<any>(null);

  // MTN MoMo Merchant Verification State
  const [mtnStatusFilter, setMtnStatusFilter] = useState<'all' | 'pending_verification' | 'verified' | 'rejected' | 'unsubmitted'>('all');
  const [mtnSearchTerm, setMtnSearchTerm] = useState('');
  const [verifyingMtnOrderRef, setVerifyingMtnOrderRef] = useState<string | null>(null);
  const [rejectModalOrder, setRejectModalOrder] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('Transaction ID could not be confirmed on MTN MoMo merchant statement');
  const [isRejecting, setIsRejecting] = useState(false);
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);

  // Physical Sale Form
  const [saleCategory, setSaleCategory] = useState<TicketCategory>('ORDINARY');
  const [saleQty, setSaleQty] = useState(1);
  const [saleBuyerName, setSaleBuyerName] = useState('');
  const [saleBuyerPhone, setSaleBuyerPhone] = useState('');
  const [saleBuyerEmail, setSaleBuyerEmail] = useState('');
  const [saleError, setSaleError] = useState('');
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);

  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    const savedToken = TicketService.getAdminToken();
    if (savedToken) {
      setPasscode(savedToken);
      setIsAuthenticated(true);
    }
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsRes, ticketsRes, ordersRes, health] = await Promise.all([
        TicketService.getDashboardStats(),
        TicketService.getAllTickets(),
        TicketService.getAllOrders(),
        TicketService.checkAdminHealth(),
      ]);

      if (ticketsRes.error === 'UNAUTHORIZED' || ordersRes.error === 'UNAUTHORIZED') {
        setIsAuthenticated(false);
        setAuthError('Unauthorized. Passcode was rejected by server. Default master passcode: prince2026');
        return;
      }

      setStats(statsRes.stats);
      setTickets(ticketsRes.tickets || []);
      setOrders(ordersRes.orders || []);
      setHealthData(health);
    } catch (err) {
      console.error('Failed to load dashboard data', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRelworxOrder = async (orderRef: string) => {
    setVerifyingOrderRef(orderRef);
    setActionError(null);
    try {
      const res = await TicketService.verifyRelworxTransactionAdmin(orderRef);
      if (res.success) {
        setActionSuccess(`Relworx verified: Order ${orderRef} is confirmed & paid!`);
        await loadData();
      } else {
        setActionError(res.message || 'Relworx payment not confirmed yet.');
      }
    } catch (err: any) {
      setActionError('Error verifying with Relworx: ' + err?.message);
    } finally {
      setVerifyingOrderRef(null);
    }
  };

  const handleVerifyMtnOrder = async (orderRef: string) => {
    setVerifyingMtnOrderRef(orderRef);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await TicketService.verifyMtnPaymentAdmin(orderRef, 'Admin', 'Verified against MTN MoMo Merchant records');
      if (res.success) {
        setActionSuccess(`Verified & Issued! Order ${orderRef} marked as PAID. QR ticket passes have been activated.`);
        await loadData();
      } else {
        setActionError(res.message || 'MTN payment verification failed.');
      }
    } catch (err: any) {
      setActionError('Error verifying MTN payment: ' + (err?.message || err));
    } finally {
      setVerifyingMtnOrderRef(null);
    }
  };

  const handleConfirmRejectMtn = async () => {
    if (!rejectModalOrder) return;
    setIsRejecting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await TicketService.rejectMtnPaymentAdmin(rejectModalOrder.order_ref, rejectReason);
      if (res.success) {
        setActionSuccess(`Order ${rejectModalOrder.order_ref} rejected. Reserved tickets were released back to available inventory.`);
        setRejectModalOrder(null);
        await loadData();
      } else {
        setActionError(res.message || 'Rejection failed.');
      }
    } catch (err: any) {
      setActionError('Error rejecting payment: ' + (err?.message || err));
    } finally {
      setIsRejecting(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) {
      setAuthError('Please enter the Admin passcode.');
      return;
    }
    TicketService.setAdminToken(passcode.trim());
    setIsAuthenticated(true);
    setAuthError('');
  };

  const handleConfirmPayment = async (ticket: TicketRecord) => {
    const ok = await TicketService.confirmPayment(ticket.id);
    if (ok) {
      setActionSuccess(`Payment confirmed & Ticket #${ticket.ticket_number} marked as ISSUED.`);
      loadData();
      setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  const handleReprintPdf = async (ticket: TicketRecord) => {
    try {
      await TicketRenderer.generatePdfTicket(ticket);
    } catch (err) {
      setActionError('Error generating reprint PDF: ' + err);
    }
  };

  const handleReleaseTicket = async (ticket: TicketRecord) => {
    if (confirmReleaseId !== ticket.id) {
      setConfirmReleaseId(ticket.id);
      setTimeout(() => setConfirmReleaseId((prev) => (prev === ticket.id ? null : prev)), 4000);
      return;
    }
    setConfirmReleaseId(null);
    const ok = await TicketService.cancelTicket(ticket.id, true);
    if (ok) {
      setActionSuccess(`Ticket #${ticket.ticket_number} released back to Available inventory.`);
      loadData();
      setTimeout(() => setActionSuccess(null), 3000);
    }
  };

  const handleRecordPhysicalSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaleError('');

    if (!saleBuyerName.trim()) {
      setSaleError('Please provide attendee name.');
      return;
    }
    if (!saleBuyerPhone.trim()) {
      setSaleError('Please provide phone number.');
      return;
    }

    setIsSubmittingSale(true);
    try {
      const res = await TicketService.recordPhysicalSale({
        category: saleCategory,
        quantity: saleQty,
        buyerName: saleBuyerName,
        buyerEmail: saleBuyerEmail.trim() || `${saleBuyerName.toLowerCase().replace(/\s+/g, '')}@prince.ug`,
        buyerPhone: saleBuyerPhone,
      });

      if (!res.success) {
        setSaleError(res.message);
      } else {
        setActionSuccess(`Issued physical ticket(s) to ${saleBuyerName}!`);
        setSaleBuyerName('');
        setSaleBuyerPhone('');
        setSaleBuyerEmail('');
        setActiveTab('inventory');
        loadData();
        if (res.tickets && res.tickets[0]) {
          onViewTicket(res.tickets[0]);
        }
      }
    } catch (err: any) {
      setSaleError(err?.message || 'Error creating ticket');
    } finally {
      setIsSubmittingSale(false);
    }
  };

  const filteredTickets = tickets.filter((t) => {
    const matchesSearch =
      t.ticket_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.buyer_name && t.buyer_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (t.buyer_phone && t.buyer_phone.includes(searchTerm));

    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;

    let matchesStatus = true;
    if (statusFilter === 'available') matchesStatus = t.status === 'available';
    if (statusFilter === 'reserved') matchesStatus = t.status === 'reserved';
    if (statusFilter === 'issued') matchesStatus = t.status === 'issued';
    if (statusFilter === 'paid') matchesStatus = t.payment_status === 'paid' || t.payment_status === 'manual_paid';

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const exactUserSql = `-- POOL PARTY: Non-destructive Supabase setup & schema sync (70 passes)
create extension if not exists pgcrypto;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text unique not null,
  category text not null check (category in ('VIP', 'ORDINARY')),
  price_ugx integer not null check (price_ugx > 0),
  status text not null default 'available'
    check (status in ('available', 'reserved', 'issued', 'cancelled')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded', 'manual_paid')),
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  qr_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  checked_in_at timestamptz,
  order_ref text,
  reserved_until timestamptz,
  relworx_internal_ref text,
  constraint ticket_number_category_check check (
    (category = 'VIP' and ticket_number like 'VIP-%')
    or
    (category = 'ORDINARY' and ticket_number like 'ORD-%')
  )
);

-- Non-destructively add reservation & Relworx columns if upgrading an existing table
alter table public.tickets
  add column if not exists order_ref text,
  add column if not exists reserved_until timestamptz,
  add column if not exists relworx_internal_ref text;

create index if not exists idx_tickets_order_ref on public.tickets(order_ref);
create index if not exists idx_tickets_reserved_until on public.tickets(reserved_until);

-- Create public.orders table if missing
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_ref text unique not null,
  category text not null check (category in ('VIP', 'ORDINARY')),
  quantity integer not null check (quantity > 0 and quantity <= 10),
  unit_price_ugx integer not null check (unit_price_ugx > 0),
  total_amount_ugx integer not null check (total_amount_ugx > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  payment_method text not null default 'relworx_mobile_money',
  network text check (network in ('MTN', 'AIRTEL')),
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text not null,
  relworx_internal_ref text,
  gateway text not null default 'relworx',
  reserved_until timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table public.tickets enable row level security;
alter table public.orders enable row level security;

-- Seed 20 VIP & 50 Ordinary passes without overwriting existing records
insert into public.tickets (ticket_number, category, price_ugx)
select 'VIP-' || lpad(n::text, 3, '0'), 'VIP', 50000
from generate_series(1, 20) as n
on conflict (ticket_number) do nothing;

insert into public.tickets (ticket_number, category, price_ugx)
select 'ORD-' || lpad(n::text, 3, '0'), 'ORDINARY', 20000
from generate_series(1, 50) as n
on conflict (ticket_number) do nothing;

-- Refresh PostgREST schema cache immediately
notify pgrst, 'reload schema';`;

  const copySql = () => {
    navigator.clipboard.writeText(exactUserSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#080c14] flex items-center justify-center p-3 sm:p-4">
        <div className="w-full max-w-md bg-[#0d1522] border border-white/10 rounded-xl sm:rounded-2xl p-5 sm:p-8 shadow-2xl text-center space-y-5 sm:space-y-6">
          <div className="w-12 h-12 rounded-xl bg-amber-400/10 border border-amber-400/20 text-amber-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>

          <div>
            <h2 className="text-xl font-bold text-white font-display">
              Pool Party Staff Admin
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              70-Ticket Inventory & Gate Management · Prince Resort Bunamwaya
            </p>
          </div>

          {authError && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-lg text-xs text-rose-300">
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 text-left">
                Admin Master Passcode
              </label>
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter passcode (default: prince2026)"
                className="w-full px-3.5 sm:px-4 py-3 bg-[#080c14] border border-white/15 rounded-lg text-white text-base sm:text-sm min-h-[46px] focus:outline-none focus:border-amber-400 font-mono transition-colors"
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="w-full min-h-[46px] py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-lg text-xs uppercase tracking-wider shadow-sm transition-colors cursor-pointer"
            >
              Sign In to Dashboard
            </button>
          </form>

          <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
            <span>Passcode: <strong className="text-amber-300 font-mono">prince2026</strong></span>
            <button
              onClick={onBack}
              className="text-cyan-400 hover:underline cursor-pointer py-1"
            >
              Back to Website
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 p-3 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        
        {/* Top Navbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              onClick={onBack}
              className="p-2 min-w-[38px] min-h-[38px] flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Return to Public Website"
            >
              <ArrowLeft className="w-5 h-5 text-amber-400" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Crown className="w-4 h-4 text-amber-400 shrink-0" />
                <h1 className="text-lg sm:text-xl font-bold text-white font-display truncate">
                  Pool Party Inventory & Sales
                </h1>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Pre-Allocated 70 Tickets (20 VIP @ 50K | 50 ORD @ 20K) · Prince Resort
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={onOpenGateScanner}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-sm uppercase cursor-pointer transition-colors"
            >
              <QrCode className="w-4 h-4" />
              <span>Gate Verifier Scanner</span>
            </button>

            <button
              onClick={() => setActiveTab('physical_sale')}
              className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-sm uppercase cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Record Physical Sale</span>
            </button>

            <button
              onClick={() => setIsAuthenticated(false)}
              className="px-3 py-2 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs font-semibold rounded-lg border border-white/10 cursor-pointer transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Action Success Alert */}
        {actionSuccess && (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {actionError && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs flex items-center justify-between gap-2">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-white cursor-pointer">
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Database & Payment Gateway Status Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[#0d1522] border border-white/10 text-xs gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Database className="w-4 h-4 text-cyan-400" />
              <span>
                Database:{' '}
                {healthData?.supabaseConnected ? (
                  <strong className="text-emerald-400">Connected to Supabase Poolparty</strong>
                ) : (
                  <strong className="text-amber-300">Synchronized (In-Memory Fallback Active)</strong>
                )}
              </span>
            </div>

            <div className="h-3 w-px bg-white/10 hidden sm:block"></div>

            <div className="h-3 w-px bg-white/10 hidden sm:block"></div>

            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FFCC00] shrink-0" />
              <span>
                MTN MoMoPay:{' '}
                {healthData?.mtnMerchantConfigured ? (
                  <strong className="text-amber-300">
                    Code <code className="font-mono bg-black/40 px-1 py-0.5 rounded text-[#FFCC00]">{healthData?.mtnMerchantCode}</code> Active
                  </strong>
                ) : (
                  <strong className="text-rose-400">Merchant Code Not Set</strong>
                )}
              </span>
            </div>
          </div>

          <button
            onClick={() => setActiveTab('setup_guide')}
            className="text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer shrink-0"
          >
            <span>Credentials & Setup Guide</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Category Breakdown Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            
            {/* VIP Category Card (Cap 20) */}
            <div className="bg-[#070e1b] border-2 border-cyan-400/40 rounded-2xl p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-base font-bold text-white">VIP Inventory (20 Max)</h3>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 font-bold border border-cyan-800">
                  UGX 50,000
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#030712] p-2.5 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-400 block">Available</span>
                  <span className="text-xl font-black text-cyan-300 font-mono">
                    {stats.vip.available} / 20
                  </span>
                </div>
                <div className="bg-[#030712] p-2.5 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-400 block">Reserved</span>
                  <span className="text-xl font-black text-amber-300 font-mono">
                    {stats.vip.reserved}
                  </span>
                </div>
                <div className="bg-[#030712] p-2.5 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-400 block">Issued / Paid</span>
                  <span className="text-xl font-black text-emerald-400 font-mono">
                    {stats.vip.issued}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-slate-300">
                <span>Checked In at Gate: <strong className="text-cyan-300">{stats.vip.checkedIn}</strong></span>
                <span>Revenue: <strong className="text-cyan-300 font-mono">UGX {stats.vip.revenueUgx.toLocaleString()}</strong></span>
              </div>
            </div>

            {/* Ordinary Category Card (Cap 50) */}
            <div className="bg-[#070e1b] border-2 border-amber-400/40 rounded-2xl p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <Ticket className="w-4 h-4 text-amber-400" />
                  <h3 className="text-base font-bold text-white">Ordinary Inventory (50 Max)</h3>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 font-bold border border-amber-800">
                  UGX 20,000
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#030712] p-2.5 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-400 block">Available</span>
                  <span className="text-xl font-black text-amber-300 font-mono">
                    {stats.ordinary.available} / 50
                  </span>
                </div>
                <div className="bg-[#030712] p-2.5 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-400 block">Reserved</span>
                  <span className="text-xl font-black text-amber-300 font-mono">
                    {stats.ordinary.reserved}
                  </span>
                </div>
                <div className="bg-[#030712] p-2.5 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-400 block">Issued / Paid</span>
                  <span className="text-xl font-black text-emerald-400 font-mono">
                    {stats.ordinary.issued}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-slate-300">
                <span>Checked In at Gate: <strong className="text-amber-300">{stats.ordinary.checkedIn}</strong></span>
                <span>Revenue: <strong className="text-amber-300 font-mono">UGX {stats.ordinary.revenueUgx.toLocaleString()}</strong></span>
              </div>
            </div>

            {/* Total System Overview */}
            <div className="bg-gradient-to-br from-[#0b1b33] to-[#070e1b] border-2 border-white/15 rounded-2xl p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-base font-bold text-white">Overall 70-Ticket Status</h3>
                </div>
                <span className="text-xs font-mono text-slate-300">Cap: 70 Total</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-[#030712] p-2.5 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-400 block">Total Available</span>
                  <span className="text-xl font-black text-white font-mono">
                    {stats.overall.totalAvailable}
                  </span>
                </div>
                <div className="bg-[#030712] p-2.5 rounded-xl border border-white/5">
                  <span className="text-[10px] uppercase text-slate-400 block">Total Admitted</span>
                  <span className="text-xl font-black text-cyan-300 font-mono">
                    {stats.overall.totalCheckedIn}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-white/10">
                <span className="text-[10px] uppercase text-slate-400 block">Total Verified Paid Revenue</span>
                <span className="text-2xl font-black text-emerald-400 font-mono">
                  UGX {stats.overall.totalRevenueUgx.toLocaleString()}
                </span>
              </div>
            </div>

          </div>
        )}

        {/* Tab Controls */}
        {(() => {
          const pendingMtnCount = orders.filter((o) => o.verification_status === 'pending_verification').length;
          const totalMtnOrders = orders.filter((o) => o.payment_method === 'mtn_momo' || o.network === 'MTN' || o.mtn_transaction_id).length;
          return (
            <div className="flex items-center gap-1.5 sm:gap-2 border-b border-white/10 pb-2 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0 whitespace-nowrap">
              <button
                onClick={() => setActiveTab('mtn_payments')}
                className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-2 shrink-0 min-h-[38px] ${
                  activeTab === 'mtn_payments' ? 'bg-[#FFCC00] text-slate-950 font-black' : 'text-slate-400 hover:text-white bg-white/5'
                }`}
              >
                <span>MTN MoMo Desk</span>
                {pendingMtnCount > 0 ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-black bg-rose-600 text-white animate-pulse">
                    {pendingMtnCount} Review
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-amber-300 font-mono">
                    {totalMtnOrders}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('inventory')}
                className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 min-h-[38px] ${
                  activeTab === 'inventory' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white bg-white/5'
                }`}
              >
                70 Inventory ({tickets.length})
              </button>
              <button
                onClick={() => setActiveTab('orders')}
                className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 min-h-[38px] ${
                  activeTab === 'orders' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white bg-white/5'
                }`}
              >
                <span>All Orders ({orders.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('physical_sale')}
                className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 min-h-[38px] ${
                  activeTab === 'physical_sale' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white bg-white/5'
                }`}
              >
                Record Cash Sale
              </button>
              <button
                onClick={() => setActiveTab('setup_guide')}
                className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 min-h-[38px] ${
                  activeTab === 'setup_guide' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white bg-white/5'
                }`}
              >
                Setup Guide
              </button>
            </div>
          );
        })()}

        {/* TAB: MTN Mobile Money Merchant Payments & Verification */}
        {activeTab === 'mtn_payments' && (
          <div className="bg-[#070e1b] border-2 border-amber-400/40 rounded-2xl p-5 sm:p-6 space-y-5 shadow-2xl">
            {/* Header & Quick stats */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FFCC00]" />
                  <h3 className="text-lg font-black text-white font-display">
                    MTN Mobile Money Merchant Verification Desk
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Cross-verify customer-submitted MTN Transaction IDs against your MTN MoMo merchant statement before issuing passes.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={loadData}
                  disabled={loading}
                  className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/15 text-slate-200 text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-amber-400' : ''}`} />
                  <span>Refresh List</span>
                </button>
              </div>
            </div>

            {/* Merchant Code Alert Notice */}
            {healthData && !healthData.mtnMerchantConfigured && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-amber-300 block">MTN Merchant Code Not Yet Configured</span>
                  <p className="text-amber-200/80 mt-0.5">
                    Add <code className="font-mono bg-black/50 px-1 py-0.5 rounded text-amber-300">MTN_MERCHANT_CODE=XXXXXX</code> in your server environment (.env) to display the live merchant code on customer checkout.
                  </p>
                </div>
              </div>
            )}

            {/* Top Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-[#030712] border border-amber-400/30">
                <span className="text-[10px] uppercase font-bold text-amber-400 block tracking-wider">
                  Awaiting Verification
                </span>
                <span className="text-2xl font-black text-amber-300 font-mono mt-0.5 block">
                  {orders.filter((o) => o.verification_status === 'pending_verification').length}
                </span>
                <span className="text-[10px] text-slate-500 block">Tx ID submitted by buyer · Pending review</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#030712] border border-emerald-500/30">
                <span className="text-[10px] uppercase font-bold text-emerald-400 block tracking-wider">
                  Verified & Active Passes
                </span>
                <span className="text-2xl font-black text-emerald-300 font-mono mt-0.5 block">
                  {orders.filter((o) => o.verification_status === 'verified').length}
                </span>
                <span className="text-[10px] text-slate-500 block">QR code activated & ready for gate scanner</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#030712] border border-white/10">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Configured Merchant Code
                </span>
                <span className="text-lg font-black text-white font-mono mt-0.5 block tracking-wider">
                  {healthData?.mtnMerchantCode || 'Not Set'}
                </span>
                <span className="text-[10px] text-slate-500 block">{healthData?.mtnMerchantName || 'Prince Resort Bunamwaya'}</span>
              </div>
            </div>

            {/* Filters & Search */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
              <div className="relative w-full sm:w-80">
                <input
                  type="text"
                  value={mtnSearchTerm}
                  onChange={(e) => setMtnSearchTerm(e.target.value)}
                  placeholder="Search Tx ID, order ref, phone, name..."
                  className="w-full px-4 py-2 pl-9 bg-[#030712] border border-white/15 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 font-mono"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={mtnStatusFilter}
                  onChange={(e) => setMtnStatusFilter(e.target.value as any)}
                  className="px-3 py-2 bg-[#030712] border border-white/15 rounded-xl text-xs text-white focus:outline-none"
                >
                  <option value="all">All Verification Statuses</option>
                  <option value="pending_verification">Pending Verification Only</option>
                  <option value="verified">Verified & Issued</option>
                  <option value="rejected">Rejected</option>
                  <option value="unsubmitted">Awaiting Customer Tx ID</option>
                </select>
              </div>
            </div>

            {/* Orders Table */}
            {(() => {
              const mtnOrders = orders.filter((o) => {
                // Must be MTN MoMo or have verification info
                const isMtn = o.payment_method === 'mtn_momo' || o.network === 'MTN' || o.mtn_transaction_id || o.verification_status;
                if (!isMtn) return false;

                const statusMatch =
                  mtnStatusFilter === 'all'
                    ? true
                    : mtnStatusFilter === 'pending_verification'
                    ? o.verification_status === 'pending_verification'
                    : mtnStatusFilter === 'verified'
                    ? o.verification_status === 'verified'
                    : mtnStatusFilter === 'rejected'
                    ? o.verification_status === 'rejected'
                    : o.verification_status === 'unsubmitted' || !o.verification_status;

                const term = mtnSearchTerm.trim().toLowerCase();
                const searchMatch =
                  !term ||
                  (o.mtn_transaction_id && o.mtn_transaction_id.toLowerCase().includes(term)) ||
                  (o.order_ref && o.order_ref.toLowerCase().includes(term)) ||
                  (o.payer_phone && o.payer_phone.toLowerCase().includes(term)) ||
                  (o.buyer_name && o.buyer_name.toLowerCase().includes(term)) ||
                  (o.buyer_phone && o.buyer_phone.toLowerCase().includes(term));

                return statusMatch && searchMatch;
              });

              if (mtnOrders.length === 0) {
                return (
                  <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-white/10 rounded-xl">
                    No MTN Mobile Money orders match the current filter.
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  {/* Mobile Order Cards */}
                  <div className="block lg:hidden space-y-3">
                    {mtnOrders.map((ord) => {
                      const isVip = ord.category === 'VIP';
                      const isPendingReview = ord.verification_status === 'pending_verification';
                      const isVerified = ord.verification_status === 'verified';
                      const isRejected = ord.verification_status === 'rejected';

                      return (
                        <div
                          key={`mobile-${ord.id || ord.order_ref}`}
                          className="bg-[#030712] border border-white/10 rounded-xl p-3.5 space-y-3"
                        >
                          {/* Top Row: Ref & Tier */}
                          <div className="flex items-start justify-between gap-2 border-b border-white/5 pb-2">
                            <div className="min-w-0">
                              <span className="font-mono text-xs font-bold text-cyan-300 break-all block">
                                {ord.order_ref}
                              </span>
                              <span className="text-[10px] text-slate-500 block">
                                {new Date(ord.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                              </span>
                            </div>
                            <span className={`shrink-0 font-extrabold text-[10px] uppercase px-2 py-0.5 rounded ${
                              isVip ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                            }`}>
                              {ord.quantity}× {ord.category}
                            </span>
                          </div>

                          {/* Attendee Info */}
                          <div className="text-xs space-y-0.5">
                            <span className="font-bold text-white block">{ord.buyer_name}</span>
                            <span className="text-slate-400 font-mono text-[11px] block">{ord.buyer_phone}</span>
                            <span className="text-slate-500 text-[10px] block truncate">{ord.buyer_email}</span>
                          </div>

                          {/* MTN Tx ID Box */}
                          <div className="bg-[#080c14] p-2.5 rounded-lg border border-white/10 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-[9.5px] uppercase text-slate-400 font-bold block">MTN Tx ID</span>
                              {ord.mtn_transaction_id ? (
                                <span className="font-mono font-bold text-amber-300 text-xs break-all block">
                                  {ord.mtn_transaction_id}
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-500 italic block">Awaiting submission</span>
                              )}
                            </div>
                            {ord.mtn_transaction_id && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(ord.mtn_transaction_id);
                                  setCopiedTxId(ord.mtn_transaction_id);
                                  setTimeout(() => setCopiedTxId(null), 2000);
                                }}
                                className="px-2.5 py-1.5 bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 text-xs font-bold rounded-md flex items-center gap-1 cursor-pointer shrink-0 min-h-[32px]"
                              >
                                {copiedTxId === ord.mtn_transaction_id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>

                          {/* Price & Status Row */}
                          <div className="flex items-center justify-between text-xs pt-1">
                            <div>
                              <span className="text-[10px] uppercase text-slate-400 block font-semibold">Total Amount</span>
                              <span className="font-mono font-bold text-white text-sm">
                                UGX {Number(ord.total_amount_ugx).toLocaleString()}
                              </span>
                            </div>
                            <div>
                              {isPendingReview ? (
                                <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500 animate-pulse">
                                  <Clock className="w-3 h-3" />
                                  <span>Pending Review</span>
                                </span>
                              ) : isVerified ? (
                                <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Verified & Issued</span>
                                </span>
                              ) : isRejected ? (
                                <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-700">
                                  <XCircle className="w-3 h-3" />
                                  <span>Rejected</span>
                                </span>
                              ) : (
                                <span className="inline-block font-medium text-[10px] uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                                  Unsubmitted
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Action Buttons for Mobile */}
                          {isPendingReview && (
                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
                              <button
                                type="button"
                                onClick={() => handleVerifyMtnOrder(ord.order_ref)}
                                disabled={verifyingMtnOrderRef === ord.order_ref}
                                className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs uppercase rounded-lg flex items-center justify-center gap-1.5 cursor-pointer min-h-[42px]"
                              >
                                {verifyingMtnOrderRef === ord.order_ref ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                )}
                                <span>Verify & Issue</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectModalOrder(ord);
                                  setRejectReason('Transaction ID could not be confirmed on MTN MoMo merchant statement');
                                }}
                                className="py-2.5 px-3 bg-rose-950/60 hover:bg-rose-900 border border-rose-700/50 text-rose-300 text-xs font-bold uppercase rounded-lg cursor-pointer min-h-[42px]"
                              >
                                Reject
                              </button>
                            </div>
                          )}

                          {isVerified && (
                            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                              <button
                                type="button"
                                onClick={() => {
                                  const tList = tickets.filter((t) => t.order_ref === ord.order_ref);
                                  if (tList.length > 0) {
                                    onViewTicket(tList[0]);
                                  } else {
                                    setActiveTab('inventory');
                                    setActionSuccess('Switched to Inventory tab to view passes.');
                                  }
                                }}
                                className="flex-1 py-2 px-3 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold rounded-lg cursor-pointer text-center min-h-[38px]"
                              >
                                View Pass
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const tList = tickets.filter((t) => t.order_ref === ord.order_ref);
                                  if (tList.length > 0) {
                                    await handleReprintPdf(tList[0]);
                                  } else {
                                    setActionError('No ticket record found for reprint.');
                                  }
                                }}
                                className="py-2 px-3 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 text-xs font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer min-h-[38px]"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>PDF</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop Table */}
                  <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400 uppercase text-[10px] tracking-wider">
                        <th className="py-3 px-3">Order Ref / Time</th>
                        <th className="py-3 px-3">Attendee</th>
                        <th className="py-3 px-3">MTN Tx ID & Payer</th>
                        <th className="py-3 px-3">Pass Tier</th>
                        <th className="py-3 px-3">Amount (UGX)</th>
                        <th className="py-3 px-3">Verification</th>
                        <th className="py-3 px-3 text-right">Admin Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {mtnOrders.map((ord) => {
                        const isVip = ord.category === 'VIP';
                        const isPendingReview = ord.verification_status === 'pending_verification';
                        const isVerified = ord.verification_status === 'verified';
                        const isRejected = ord.verification_status === 'rejected';

                        return (
                          <tr key={ord.id || ord.order_ref} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-3 px-3 font-mono">
                              <span className="font-bold text-cyan-300 block">{ord.order_ref}</span>
                              <span className="text-[10px] text-slate-500">
                                {new Date(ord.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                              </span>
                            </td>

                            <td className="py-3 px-3">
                              <span className="font-bold text-white block">{ord.buyer_name}</span>
                              <span className="text-[11px] text-slate-400 font-mono block">{ord.buyer_phone}</span>
                              <span className="text-[10px] text-slate-500">{ord.buyer_email}</span>
                            </td>

                            <td className="py-3 px-3">
                              {ord.mtn_transaction_id ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-black text-amber-300 bg-amber-950/60 border border-amber-500/40 px-2 py-0.5 rounded text-[11px]">
                                      {ord.mtn_transaction_id}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(ord.mtn_transaction_id);
                                        setCopiedTxId(ord.mtn_transaction_id);
                                        setTimeout(() => setCopiedTxId(null), 2000);
                                      }}
                                      className="p-1 text-slate-400 hover:text-white cursor-pointer"
                                      title="Copy Transaction ID"
                                    >
                                      {copiedTxId === ord.mtn_transaction_id ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                      ) : (
                                        <Copy className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-mono block">
                                    Payer Phone: <strong className="text-white">{ord.payer_phone || ord.buyer_phone}</strong>
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-500 italic">
                                  Awaiting buyer submission
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-3">
                              <span className={`inline-block font-extrabold text-[10px] uppercase px-2 py-0.5 rounded ${
                                isVip ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                              }`}>
                                {ord.quantity}× {ord.category}
                              </span>
                            </td>

                            <td className="py-3 px-3 font-mono font-bold text-white">
                              UGX {Number(ord.total_amount_ugx).toLocaleString()}
                            </td>

                            <td className="py-3 px-3">
                              {isPendingReview ? (
                                <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase px-2.5 py-1 rounded bg-amber-950 text-amber-300 border border-amber-500 animate-pulse">
                                  <Clock className="w-3 h-3" />
                                  <span>Pending Review</span>
                                </span>
                              ) : isVerified ? (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Verified & Issued</span>
                                  </span>
                                  {ord.verified_at && (
                                    <span className="block text-[9px] text-slate-400 font-mono">
                                      By {ord.verified_by || 'Admin'} · {new Date(ord.verified_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                              ) : isRejected ? (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-700">
                                    <XCircle className="w-3 h-3" />
                                    <span>Rejected</span>
                                  </span>
                                  {ord.rejection_reason && (
                                    <span className="block text-[10px] text-rose-400 max-w-[140px] truncate" title={ord.rejection_reason}>
                                      {ord.rejection_reason}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-block font-medium text-[10px] uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                                  Unsubmitted
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                {isPendingReview && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleVerifyMtnOrder(ord.order_ref)}
                                      disabled={verifyingMtnOrderRef === ord.order_ref}
                                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-[10px] uppercase rounded flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                                      title="Mark paid and activate QR ticket passes"
                                    >
                                      {verifyingMtnOrderRef === ord.order_ref ? (
                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <CheckCircle2 className="w-3 h-3" />
                                      )}
                                      <span>Verify & Issue</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRejectModalOrder(ord);
                                        setRejectReason('Transaction ID could not be confirmed on MTN MoMo merchant statement');
                                      }}
                                      className="px-2 py-1 bg-rose-950/60 hover:bg-rose-900 border border-rose-700/50 text-rose-300 text-[10px] font-bold uppercase rounded cursor-pointer"
                                      title="Reject payment and release tickets back to available stock"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}

                                {isVerified && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const tList = tickets.filter((t) => t.order_ref === ord.order_ref);
                                        if (tList.length > 0) {
                                          onViewTicket(tList[0]);
                                        } else {
                                          setActiveTab('inventory');
                                          setActionSuccess('Switched to Inventory tab to view passes.');
                                        }
                                      }}
                                      className="px-2 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 text-[10px] font-bold rounded cursor-pointer"
                                    >
                                      View Pass
                                    </button>

                                    <button
                                      type="button"
                                      onClick={async () => {
                                        const tList = tickets.filter((t) => t.order_ref === ord.order_ref);
                                        if (tList.length > 0) {
                                          await handleReprintPdf(tList[0]);
                                        } else {
                                          setActionError('No ticket record found for reprint.');
                                        }
                                      }}
                                      className="px-2 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 text-[10px] font-bold rounded flex items-center gap-1 cursor-pointer"
                                      title="Reprint personalized PDF ticket"
                                    >
                                      <Printer className="w-3 h-3" />
                                      <span>Reprint</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          </div>
        )}

        {/* Rejection Reason Modal */}
        {rejectModalOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 xs:p-3 sm:p-4 bg-black/85 backdrop-blur-sm overflow-y-auto">
            <div className="bg-[#0b1220] border-2 border-rose-500/60 rounded-xl sm:rounded-2xl p-4 sm:p-6 max-w-md w-full space-y-3.5 sm:space-y-4 shadow-2xl my-auto max-h-[94vh] overflow-y-auto">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h4 className="text-sm sm:text-base font-bold text-white font-display">
                  Reject MTN Mobile Money Payment
                </h4>
              </div>

              <div className="text-xs text-slate-300 space-y-1">
                <p>
                  You are rejecting order <strong className="font-mono text-cyan-300 break-all">{rejectModalOrder.order_ref}</strong> for <strong className="text-white">{rejectModalOrder.buyer_name}</strong>.
                </p>
                <p className="text-slate-400">
                  Transaction ID: <strong className="font-mono text-amber-300 break-all">{rejectModalOrder.mtn_transaction_id || 'None'}</strong>
                </p>
                <p className="text-amber-300 font-semibold pt-1">
                  The {rejectModalOrder.quantity} reserved {rejectModalOrder.category} pass(es) will be released back to Available Inventory immediately.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Reason for Rejection <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 bg-[#030712] border border-white/15 rounded-xl text-base sm:text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-400"
                  placeholder="e.g. Transaction ID was not found on our MTN MoMo statement, or amount was incorrect."
                />
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isRejecting}
                  onClick={() => setRejectModalOrder(null)}
                  className="w-full sm:w-auto min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRejecting || !rejectReason.trim()}
                  onClick={handleConfirmRejectMtn}
                  className="w-full sm:w-auto min-h-[42px] px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                >
                  {isRejecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                  <span>Confirm Reject & Release Stock</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 1: Inventory Table */}
        {activeTab === 'inventory' && (
          <div className="bg-[#070e1b] border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl">
            {/* Search and Filters */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search VIP-001, ORD-001, name, phone..."
                  className="w-full px-4 py-2 pl-9 bg-[#030712] border border-white/15 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as any)}
                  className="px-3 py-2 bg-[#030712] border border-white/15 rounded-xl text-xs text-white focus:outline-none"
                >
                  <option value="all">All Tiers (70 Total)</option>
                  <option value="VIP">VIP (20 Max)</option>
                  <option value="ORDINARY">ORDINARY (50 Max)</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-3 py-2 bg-[#030712] border border-white/15 rounded-xl text-xs text-white focus:outline-none"
                >
                  <option value="all">All Statuses</option>
                  <option value="available">Available (Unsold)</option>
                  <option value="reserved">Reserved (Pending Pay)</option>
                  <option value="issued">Issued / Confirmed</option>
                  <option value="paid">Paid</option>
                </select>

                <button
                  onClick={loadData}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white cursor-pointer"
                  title="Refresh Table"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400 uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-3">Ticket #</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Price</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Payment</th>
                    <th className="py-3 px-3">Attendee</th>
                    <th className="py-3 px-3">Check-In</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-sans">
                  {filteredTickets.map((t) => (
                    <tr key={t.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-3 px-3 font-mono font-bold text-cyan-300">
                        {t.ticket_number}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          t.category === 'VIP' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}>
                          {t.category}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-300">
                        UGX {t.price_ugx.toLocaleString()}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          t.status === 'available'
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                            : t.status === 'reserved'
                            ? 'bg-amber-950/60 text-amber-400 border border-amber-800'
                            : t.status === 'issued'
                            ? 'bg-blue-950/60 text-blue-300 border border-blue-800'
                            : 'bg-rose-950/60 text-rose-400'
                        }`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-medium uppercase">
                        {t.payment_status === 'paid' || t.payment_status === 'manual_paid' ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{t.payment_status}</span>
                          </span>
                        ) : t.payment_status === 'pending' ? (
                          <span className="text-amber-400 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            <span>pending</span>
                          </span>
                        ) : (
                          <span className="text-slate-500">unpaid</span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-medium text-white">
                        {t.buyer_name || <span className="text-slate-600 italic">None (Available)</span>}
                      </td>
                      <td className="py-3 px-3">
                        {t.checked_in_at ? (
                          <span className="text-rose-400 font-bold">
                            Admitted ({new Date(t.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                          </span>
                        ) : (
                          <span className="text-slate-500">No</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* If reserved & pending, allow payment confirmation */}
                          {t.status === 'reserved' && (
                            <button
                              onClick={() => handleConfirmPayment(t)}
                              className="px-2.5 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded text-[10px] uppercase cursor-pointer"
                              title="Mark as paid and issue"
                            >
                              Confirm Pay
                            </button>
                          )}

                          {/* View Canva Ticket */}
                          {t.status !== 'available' && (
                            <button
                              onClick={() => onViewTicket(t)}
                              className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-[10px] font-semibold cursor-pointer"
                              title="View Canva ticket preview"
                            >
                              View
                            </button>
                          )}

                          {/* 9. Reprint Ticket (PDF without creating new token) */}
                          {t.status !== 'available' && (
                            <button
                              onClick={() => handleReprintPdf(t)}
                              className="px-2.5 py-1 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-700 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                              title="Reprint without altering QR token"
                            >
                              <Printer className="w-3 h-3" />
                              <span>Reprint</span>
                            </button>
                          )}

                          {/* Release back to available */}
                          {t.status !== 'available' && (
                            <button
                              onClick={() => handleReleaseTicket(t)}
                              className={`p-1 rounded cursor-pointer ${
                                confirmReleaseId === t.id
                                  ? 'px-2 py-0.5 bg-rose-600 text-white text-[10px] font-bold uppercase'
                                  : 'hover:text-rose-400 text-slate-500'
                              }`}
                              title="Release back to inventory"
                            >
                              {confirmReleaseId === t.id ? 'Confirm?' : <XCircle className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: Flutterwave Orders & Mobile Money Logs */}
        {activeTab === 'orders' && (
          <div className="bg-[#070e1b] border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <h3 className="text-base font-bold text-white font-display flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-amber-400" />
                  <span>Relworx Mobile Money Transactions & Orders</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Real-time transaction log. 10-minute reservations expire automatically if unpaid.
                </p>
              </div>

              <button
                onClick={loadData}
                disabled={loading}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer border border-white/10"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-amber-400' : ''}`} />
                <span>Refresh Orders</span>
              </button>
            </div>

            {orders.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No orders recorded yet. As customers select MTN/Airtel on the website, orders will appear here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 uppercase text-[10px] tracking-wider">
                      <th className="py-3 px-3">Order Ref</th>
                      <th className="py-3 px-3">Attendee</th>
                      <th className="py-3 px-3">Pass Tier</th>
                      <th className="py-3 px-3">Network</th>
                      <th className="py-3 px-3">Amount (UGX)</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3">Date</th>
                      <th className="py-3 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {orders.map((ord) => {
                      const isVip = ord.category === 'VIP';
                      const isPaid = ord.status === 'paid';
                      const isPending = ord.status === 'pending';

                      return (
                        <tr key={ord.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-3 font-mono font-bold text-cyan-300">
                            {ord.order_ref}
                            {(ord.relworx_internal_ref || ord.flw_ref) && (
                              <span className="block text-[10px] font-normal text-slate-500 font-mono">
                                Relworx: {ord.relworx_internal_ref || ord.flw_ref}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <span className="font-bold text-white block">{ord.buyer_name}</span>
                            <span className="text-[11px] text-slate-400 font-mono block">{ord.buyer_phone}</span>
                            <span className="text-[10px] text-slate-500">{ord.buyer_email}</span>
                          </td>
                          <td className="py-3 px-3">
                            <span className={`inline-block font-extrabold text-[10px] uppercase px-2 py-0.5 rounded ${
                              isVip ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                            }`}>
                              {ord.quantity}× {ord.category}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-300">
                            {ord.network === 'MTN' ? (
                              <span className="text-amber-400 font-bold">MTN MoMo</span>
                            ) : ord.network === 'AIRTEL' ? (
                              <span className="text-red-400 font-bold">Airtel</span>
                            ) : (
                              ord.payment_method || 'Box Office'
                            )}
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-white">
                            UGX {Number(ord.total_amount_ugx).toLocaleString()}
                          </td>
                          <td className="py-3 px-3">
                            <span className={`inline-block font-bold text-[10px] uppercase px-2 py-0.5 rounded ${
                              isPaid
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                                : isPending
                                ? 'bg-amber-950 text-amber-300 border border-amber-700 animate-pulse'
                                : 'bg-slate-800 text-slate-400'
                            }`}>
                              {ord.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-slate-400 text-[11px]">
                            {new Date(ord.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {isPending && (
                                <button
                                  onClick={() => handleVerifyRelworxOrder(ord.order_ref)}
                                  disabled={verifyingOrderRef === ord.order_ref}
                                  className="px-2.5 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1"
                                  title="Check status with Relworx API"
                                >
                                  <RefreshCw className={`w-3 h-3 ${verifyingOrderRef === ord.order_ref ? 'animate-spin' : ''}`} />
                                  <span>Verify Relworx</span>
                                </button>
                              )}

                              {isPaid && (
                                <button
                                  onClick={async () => {
                                    const tList = tickets.filter((t) => t.order_ref === ord.order_ref);
                                    if (tList.length > 0) {
                                      onViewTicket(tList[0]);
                                    } else {
                                      setActiveTab('inventory');
                                      setActionSuccess('Switched to Inventory tab to view tickets for this order.');
                                    }
                                  }}
                                  className="px-2 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-bold rounded-lg cursor-pointer"
                                >
                                  View Passes
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Record Physical Staff Sale */}
        {activeTab === 'physical_sale' && (
          <div className="max-w-xl mx-auto bg-[#070e1b] border-2 border-amber-400/50 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-5">
            <div>
              <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
                <Ticket className="w-4 h-4" />
                <span>Prince Resort Box Office</span>
              </div>
              <h3 className="text-xl font-bold text-white font-display">
                Record Physical Staff Sale (Cash / POS)
              </h3>
              <p className="text-xs text-slate-400">
                Claims the next available pre-allocated ticket, sets status to <strong>issued</strong> and payment to <strong>manual_paid</strong>, and generates the print-ready Canva ticket.
              </p>
            </div>

            {saleError && (
              <div className="p-3 bg-rose-950/60 border border-rose-500 rounded-xl text-xs text-rose-300">
                {saleError}
              </div>
            )}

            <form onSubmit={handleRecordPhysicalSale} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                  Select Ticket Tier
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSaleCategory('ORDINARY')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      saleCategory === 'ORDINARY'
                        ? 'bg-amber-950/50 border-amber-400 text-white'
                        : 'bg-[#030712] border-white/10 text-slate-400'
                    }`}
                  >
                    <span className="block text-xs font-bold">ORDINARY Pass</span>
                    <span className="text-sm font-black text-amber-300 font-mono">UGX 20,000</span>
                    <span className="block text-[10px] text-slate-400 mt-1">Available: {stats ? stats.ordinary.available : 50}/50</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSaleCategory('VIP')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      saleCategory === 'VIP'
                        ? 'bg-cyan-950/50 border-cyan-400 text-white'
                        : 'bg-[#030712] border-white/10 text-slate-400'
                    }`}
                  >
                    <span className="block text-xs font-bold">VIP Pass</span>
                    <span className="text-sm font-black text-cyan-300 font-mono">UGX 50,000</span>
                    <span className="block text-[10px] text-slate-400 mt-1">Available: {stats ? stats.vip.available : 20}/20</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">
                  Ticket Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={saleQty}
                  onChange={(e) => setSaleQty(parseInt(e.target.value) || 1)}
                  className="w-full px-4 py-2.5 bg-[#030712] border border-white/15 rounded-xl text-white text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">
                  Buyer / Attendee Full Name <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  value={saleBuyerName}
                  onChange={(e) => setSaleBuyerName(e.target.value)}
                  placeholder="e.g. Grace Tumusiime"
                  className="w-full px-4 py-2.5 bg-[#030712] border border-white/15 rounded-xl text-white text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">
                  Phone Number <span className="text-amber-400">*</span>
                </label>
                <input
                  type="tel"
                  value={saleBuyerPhone}
                  onChange={(e) => setSaleBuyerPhone(e.target.value)}
                  placeholder="0772 123 456"
                  className="w-full px-4 py-2.5 bg-[#030712] border border-white/15 rounded-xl text-white text-sm"
                  required
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmittingSale}
                  className="w-full py-3.5 bg-gradient-to-r from-amber-400 to-amber-300 hover:from-amber-300 hover:to-amber-200 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider shadow-lg active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  <span>Issue & Print Ticket Now</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: Supabase Schema Script */}
        {activeTab === 'setup_guide' && (
          <div className="bg-[#070e1b] border border-white/10 rounded-2xl p-6 sm:p-8 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-white font-display">
                  Your Exact Supabase SQL Script
                </h3>
                <p className="text-xs text-slate-400">
                  Pre-populates exactly 20 VIP tickets (VIP-001 to VIP-020) and 50 Ordinary tickets (ORD-001 to ORD-050).
                </p>
              </div>

              <button
                onClick={copySql}
                className="px-4 py-2 bg-cyan-950 hover:bg-cyan-900 border border-cyan-600 text-cyan-300 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                {copiedSql ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                <span>{copiedSql ? 'Copied!' : 'Copy SQL'}</span>
              </button>
            </div>

            <pre className="p-4 bg-[#030712] rounded-xl border border-white/10 text-cyan-200 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-72">
              {exactUserSql}
            </pre>

            {/* MTN Mobile Money & Relworx Setup */}
            <div className="pt-4 border-t border-white/10 space-y-4">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#FFCC00]" />
                <span>MTN Mobile Money Merchant Payment Configuration</span>
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-[#030712] border border-amber-400/20 space-y-2">
                  <span className="font-bold text-amber-300 block">1. MTN Merchant Code</span>
                  <p className="text-slate-400 leading-relaxed">
                    Set your real MTN Merchant Code / MoMoPay ID in your server environment variables. This code is shown to buyers when they dial <strong>*165*3#</strong> to pay.
                  </p>
                  <code className="block p-2 rounded bg-black/60 font-mono text-[11px] text-amber-300 select-all">
                    MTN_MERCHANT_CODE=your_merchant_code
                  </code>
                </div>

                <div className="p-4 rounded-xl bg-[#030712] border border-cyan-400/20 space-y-2">
                  <span className="font-bold text-cyan-300 block">2. Admin Passcode</span>
                  <p className="text-slate-400 leading-relaxed">
                    Secure the Admin verification dashboard. All payment verifications and ticket release actions require this passcode.
                  </p>
                  <code className="block p-2 rounded bg-black/60 font-mono text-[11px] text-cyan-300 select-all">
                    ADMIN_PASSCODE=your_secure_passcode
                  </code>
                </div>
              </div>

              {/* Required Environment Variables Card */}
              <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-2 text-xs">
                <span className="font-bold text-slate-200 block">3. Required Environment Variables (.env)</span>
                <pre className="p-3 bg-[#030712] rounded-lg text-emerald-300 font-mono text-[11px] leading-relaxed overflow-x-auto">
{`# MTN Mobile Money Merchant Payments
MTN_MERCHANT_CODE=556677
MTN_MERCHANT_NAME="Prince Resort Bunamwaya"

# Admin Authentication
ADMIN_PASSCODE=prince2026

# Supabase Database (Project: Poolparty)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
                </pre>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
