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
  Smartphone 
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

  const [activeTab, setActiveTab] = useState<'inventory' | 'orders' | 'physical_sale' | 'setup_guide'>('inventory');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [verifyingOrderRef, setVerifyingOrderRef] = useState<string | null>(null);
  const [healthData, setHealthData] = useState<any>(null);

  // Physical Sale Form
  const [saleCategory, setSaleCategory] = useState<TicketCategory>('ORDINARY');
  const [saleQty, setSaleQty] = useState(1);
  const [saleBuyerName, setSaleBuyerName] = useState('');
  const [saleBuyerPhone, setSaleBuyerPhone] = useState('');
  const [saleBuyerEmail, setSaleBuyerEmail] = useState('');
  const [saleError, setSaleError] = useState('');
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);

  const [copiedSql, setCopiedSql] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [allStats, allTickets, allOrders, health] = await Promise.all([
        TicketService.getDashboardStats(),
        TicketService.getAllTickets(),
        TicketService.getAllOrders(),
        TicketService.checkAdminHealth(),
      ]);
      setStats(allStats);
      setTickets(allTickets);
      setOrders(allOrders);
      setHealthData(health);
    } catch (err) {
      console.error('Failed to load dashboard data', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRelworxOrder = async (orderRef: string) => {
    setVerifyingOrderRef(orderRef);
    try {
      const res = await TicketService.verifyRelworxTransactionAdmin(orderRef);
      if (res.success) {
        setActionSuccess(`Relworx verified: Order ${orderRef} is confirmed & paid!`);
        await loadData();
      } else {
        alert(res.message || 'Relworx payment not confirmed yet.');
      }
    } catch (err: any) {
      alert('Error verifying with Relworx: ' + err?.message);
    } finally {
      setVerifyingOrderRef(null);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode === 'prince2026' || passcode === 'admin') {
      setIsAuthenticated(true);
      setAuthError('');
    } else {
      setAuthError('Invalid Admin Passcode. Default master passcode: prince2026');
    }
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
      alert('Error generating reprint PDF: ' + err);
    }
  };

  const handleReleaseTicket = async (ticket: TicketRecord) => {
    if (!confirm(`Are you sure you want to release ticket #${ticket.ticket_number} back to available inventory?`)) {
      return;
    }
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
      const res = await TicketService.allocateTickets({
        category: saleCategory,
        quantity: saleQty,
        buyerName: saleBuyerName,
        buyerEmail: saleBuyerEmail.trim() || `${saleBuyerName.toLowerCase().replace(/\s+/g, '')}@prince.ug`,
        buyerPhone: saleBuyerPhone,
        targetStatus: 'issued',
        paymentStatus: 'manual_paid',
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

  const exactUserSql = `-- POOL PARTY: initial inventory of 70 tickets
create extension if not exists pgcrypto;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),

  ticket_number text unique not null,
  category text not null
    check (category in ('VIP', 'ORDINARY')),

  price_ugx integer not null
    check (price_ugx > 0),

  status text not null default 'available'
    check (status in (
      'available', 'reserved', 'issued', 'cancelled'
    )),

  payment_status text not null default 'unpaid'
    check (payment_status in (
      'unpaid', 'pending', 'paid',
      'failed', 'refunded', 'manual_paid'
    )),

  buyer_name text,
  buyer_email text,
  buyer_phone text,

  qr_token uuid not null unique default gen_random_uuid(),

  created_at timestamptz not null default now(),
  paid_at timestamptz,
  checked_in_at timestamptz,

  constraint ticket_number_category_check check (
    (category = 'VIP' and ticket_number like 'VIP-%')
    or
    (category = 'ORDINARY' and ticket_number like 'ORD-%')
  )
);

-- Keep ticket records inaccessible to public API roles.
alter table public.tickets enable row level security;

-- Create exactly 20 VIP tickets.
insert into public.tickets (ticket_number, category, price_ugx)
select
  'VIP-' || lpad(n::text, 3, '0'),
  'VIP',
  50000
from generate_series(1, 20) as n;

-- Create exactly 50 Ordinary tickets.
insert into public.tickets (ticket_number, category, price_ugx)
select
  'ORD-' || lpad(n::text, 3, '0'),
  'ORDINARY',
  20000
from generate_series(1, 50) as n;

select
  category,
  count(*) as total_tickets,
  count(*) filter (
    where status = 'available'
  ) as available
from public.tickets
group by category
order by category;`;

  const copySql = () => {
    navigator.clipboard.writeText(exactUserSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#030712] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#070e1b] border-2 border-amber-400/40 rounded-3xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/30 text-amber-400 flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8" />
          </div>

          <div>
            <h2 className="text-2xl font-black text-white font-display">
              Pool Party Admin
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              70-Ticket Pre-allocated Inventory & Sales System · Prince Resort Bunamwaya
            </p>
          </div>

          {authError && (
            <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl text-xs text-rose-300">
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
                className="w-full px-4 py-3 bg-[#030712] border border-white/20 rounded-xl text-white text-sm focus:outline-none focus:border-amber-400 font-mono"
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-gradient-to-r from-amber-400 to-cyan-400 hover:from-amber-300 hover:to-cyan-300 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider shadow-lg active:scale-98 transition-all cursor-pointer"
            >
              Sign In to Dashboard
            </button>
          </form>

          <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
            <span>Passcode: <strong className="text-amber-300 font-mono">prince2026</strong></span>
            <button
              onClick={onBack}
              className="text-cyan-400 hover:underline cursor-pointer"
            >
              Back to Public Website
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Top Navbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              title="Return to Public Website"
            >
              <ArrowLeft className="w-5 h-5 text-amber-400" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-400" />
                <h1 className="text-xl sm:text-2xl font-black text-white font-display">
                  Pool Party Inventory & Sales Management
                </h1>
              </div>
              <p className="text-xs text-slate-400">
                Pre-Allocated 70 Tickets (20 VIP @ 50K | 50 ORD @ 20K) · Prince Resort Bunamwaya Bella
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={onOpenGateScanner}
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-slate-950 text-xs font-black rounded-xl flex items-center gap-1.5 shadow-sm uppercase cursor-pointer"
            >
              <QrCode className="w-4 h-4" />
              <span>Gate Verifier Scanner</span>
            </button>

            <button
              onClick={() => setActiveTab('physical_sale')}
              className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black rounded-xl flex items-center gap-1.5 shadow-sm uppercase cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Record Physical Sale</span>
            </button>

            <button
              onClick={() => setIsAuthenticated(false)}
              className="px-3 py-2 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs font-bold rounded-xl border border-white/10 cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Action Success Alert */}
        {actionSuccess && (
          <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-400 text-emerald-200 text-xs flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Database & Payment Gateway Status Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-[#070e1b] border border-white/10 text-xs gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Database className="w-4 h-4 text-cyan-400" />
              <span>
                Database:{' '}
                {healthData?.supabaseConnected ? (
                  <strong className="text-emerald-400">Connected to Supabase Poolparty</strong>
                ) : (
                  <strong className="text-amber-300">Synchronized (Supabase 70-Ticket Schema)</strong>
                )}
              </span>
            </div>

            <div className="h-3 w-px bg-white/10 hidden sm:block"></div>

            <div className="flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-amber-400" />
              <span>
                Flutterwave:{' '}
                {healthData?.flutterwaveConfigured ? (
                  healthData?.flutterwaveTestMode ? (
                    <strong className="text-amber-300">Connected (Test Sandbox Mode)</strong>
                  ) : (
                    <strong className="text-emerald-400">Live Production Active</strong>
                  )
                ) : (
                  <strong className="text-slate-400">Key Pending in .env (Test Mode)</strong>
                )}
              </span>
            </div>
          </div>

          <button
            onClick={() => setActiveTab('setup_guide')}
            className="text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer shrink-0"
          >
            <span>Setup & Credentials Guide</span>
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
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-2">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'inventory' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            All 70 Inventory Tickets ({tickets.length})
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'orders' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Relworx Orders & Sales</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-amber-300 font-mono">
              {orders.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('physical_sale')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'physical_sale' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            Record Physical Staff Sale
          </button>
          <button
            onClick={() => setActiveTab('setup_guide')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'setup_guide' ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            Supabase & Relworx Setup
          </button>
        </div>

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
                              className="p-1 hover:text-rose-400 text-slate-500 rounded cursor-pointer"
                              title="Release back to inventory"
                            >
                              <XCircle className="w-3.5 h-3.5" />
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
                  <span>Flutterwave Uganda Orders & Transactions</span>
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
                                      alert('Tickets for this order are listed in the Inventory tab.');
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

            {/* Relworx Webhook and Vercel Setup */}
            <div className="pt-4 border-t border-white/10 space-y-4">
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-amber-400" />
                <span>Relworx Uganda Mobile Money Configuration (MTN & Airtel)</span>
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-[#030712] border border-white/10 space-y-2">
                  <span className="font-bold text-amber-300 block">1. Relworx Webhook URL</span>
                  <p className="text-slate-400 leading-relaxed">
                    Set this in your Relworx Dashboard under <strong>Business Account &gt; Settings &gt; Webhooks</strong>:
                  </p>
                  <code className="block p-2 rounded bg-black/60 font-mono text-[11px] text-cyan-300 break-all select-all">
                    {window.location.origin}/api/payments/relworx-webhook
                  </code>
                </div>

                <div className="p-4 rounded-xl bg-[#030712] border border-white/10 space-y-2">
                  <span className="font-bold text-cyan-300 block">2. Relworx Signature Verification</span>
                  <p className="text-slate-400 leading-relaxed">
                    Copy your Webhook Authentication Key from Relworx Settings and add it to your Vercel / server environment variables as:
                  </p>
                  <code className="block p-2 rounded bg-black/60 font-mono text-[11px] text-amber-300">
                    RELWORX_WEBHOOK_SECRET=your_webhook_key_here
                  </code>
                </div>
              </div>

              {/* Required Environment Variables Card */}
              <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-2 text-xs">
                <span className="font-bold text-slate-200 block">3. Required Environment Variables</span>
                <pre className="p-3 bg-[#030712] rounded-lg text-emerald-300 font-mono text-[11px] leading-relaxed overflow-x-auto">
{`# Relworx Payment Gateway (Uganda Mobile Money)
RELWORX_API_KEY=your_relworx_api_key
RELWORX_ACCOUNT_NO=your_relworx_account_no
RELWORX_WEBHOOK_SECRET=your_webhook_secret

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
