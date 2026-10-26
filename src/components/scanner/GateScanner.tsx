import React, { useState, useEffect } from 'react';
import { 
  QrCode, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  ShieldCheck, 
  Clock, 
  Search, 
  RefreshCw, 
  UserCheck, 
  ArrowLeft,
  Crown
} from 'lucide-react';
import { TicketService } from '../../lib/ticketService';
import { CheckInResult, TicketRecord } from '../../types/inventory';

interface GateScannerProps {
  onBack: () => void;
  onViewTicket: (ticket: TicketRecord) => void;
}

export const GateScanner: React.FC<GateScannerProps> = ({ onBack, onViewTicket }) => {
  const [inputCode, setInputCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [recentScans, setRecentScans] = useState<TicketRecord[]>([]);

  const loadRecent = async () => {
    const all = await TicketService.getAllTickets();
    const used = all.filter((t) => t.checked_in_at).slice(0, 6);
    setRecentScans(used);
  };

  useEffect(() => {
    loadRecent();
  }, [result]);

  const handleVerify = async (codeToVerify?: string) => {
    const target = (codeToVerify || inputCode).trim();
    if (!target) return;

    setIsVerifying(true);
    setResult(null);

    // Extract token if a full URL was pasted
    let cleanToken = target;
    if (target.includes('verify=')) {
      const match = target.match(/verify=([^&]+)/);
      if (match) cleanToken = match[1];
    }

    try {
      const res = await TicketService.verifyAndCheckIn(cleanToken);
      setResult(res);
      if (res.status === 'ADMITTED') {
        setInputCode('');
      }
    } catch (err) {
      setResult({
        status: 'INVALID',
        message: 'System error during verification. Check database connection.',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
              title="Return to Main Website"
            >
              <ArrowLeft className="w-5 h-5 text-amber-400" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-cyan-400" />
                <h1 className="text-xl sm:text-2xl font-black text-white font-display">
                  Prince Resort Gate Verifier
                </h1>
              </div>
              <p className="text-xs text-slate-400">
                Single-scan QR Verification & Atomic Check-In Engine · Pool Party 2026
              </p>
            </div>
          </div>

          <div className="text-xs text-slate-400 font-mono">
            Location: <span className="text-cyan-300">Prince Resort Pool Entrance</span>
          </div>
        </div>

        {/* Verification Input Box */}
        <div className="bg-[#070e1b] border-2 border-amber-400/40 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <label className="block text-xs font-bold uppercase tracking-wider text-amber-400 mb-2">
            Scan QR Code, Paste Verification URL, or Enter Ticket Number (e.g. VIP-001, ORD-001)
          </label>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleVerify();
            }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                placeholder="Scan QR or enter ticket number (e.g. VIP-001, ORD-001)"
                className="w-full px-4 py-3.5 pl-11 bg-[#030712] border border-white/20 rounded-xl text-white text-sm font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-colors"
                autoFocus
              />
              <QrCode className="w-5 h-5 text-cyan-400 absolute left-3.5 top-3.5" />
            </div>

            <button
              type="submit"
              disabled={isVerifying || !inputCode.trim()}
              className="px-8 py-3.5 bg-gradient-to-r from-amber-400 to-cyan-400 hover:from-amber-300 hover:to-cyan-300 disabled:opacity-40 text-slate-950 font-black text-sm rounded-xl transition-all shadow-md active:scale-98 whitespace-nowrap cursor-pointer uppercase flex items-center justify-center gap-2"
            >
              {isVerifying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Checking...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Verify Ticket</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Test Demo Codes */}
          <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">Quick Test Scans:</span>
            <button
              onClick={() => handleVerify('VIP-001')}
              className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-cyan-300 border border-white/10 rounded-md font-mono text-[11px] cursor-pointer"
            >
              VIP-001 (Valid Paid VIP)
            </button>
            <button
              onClick={() => handleVerify('ORD-001')}
              className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-amber-300 border border-white/10 rounded-md font-mono text-[11px] cursor-pointer"
            >
              ORD-001 (Valid Paid Ordinary)
            </button>
            <button
              onClick={() => handleVerify('ORD-002')}
              className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-rose-300 border border-white/10 rounded-md font-mono text-[11px] cursor-pointer"
            >
              ORD-002 (Already Checked In)
            </button>
            <button
              onClick={() => handleVerify('VIP-002')}
              className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-amber-400 border border-white/10 rounded-md font-mono text-[11px] cursor-pointer"
            >
              VIP-002 (Unpaid / Pending)
            </button>
          </div>
        </div>

        {/* Verification Result Card */}
        {result && (
          <div
            className={`p-6 sm:p-8 rounded-3xl border-2 transition-all shadow-2xl ${
              result.status === 'ADMITTED'
                ? 'bg-emerald-950/40 border-emerald-400'
                : result.status === 'ALREADY_USED'
                ? 'bg-rose-950/40 border-rose-500'
                : result.status === 'UNPAID'
                ? 'bg-amber-950/40 border-amber-400'
                : 'bg-red-950/40 border-red-500'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="shrink-0 mt-1">
                {result.status === 'ADMITTED' && (
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 animate-bounce" />
                )}
                {result.status === 'ALREADY_USED' && (
                  <XCircle className="w-12 h-12 text-rose-500" />
                )}
                {result.status === 'UNPAID' && (
                  <AlertTriangle className="w-12 h-12 text-amber-400" />
                )}
                {(result.status === 'CANCELLED' || result.status === 'INVALID' || result.status === 'NOT_ISSUED') && (
                  <XCircle className="w-12 h-12 text-rose-500" />
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full ${
                      result.status === 'ADMITTED'
                        ? 'bg-emerald-400 text-slate-950'
                        : result.status === 'ALREADY_USED'
                        ? 'bg-rose-500 text-white'
                        : result.status === 'UNPAID'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-red-600 text-white'
                    }`}
                  >
                    SCAN RESULT: {result.status.replace('_', ' ')}
                  </span>

                  {result.ticket && (
                    <span className="text-xs font-mono font-bold text-slate-300">
                      #{result.ticket.ticket_number}
                    </span>
                  )}
                </div>

                <h3 className="text-xl sm:text-2xl font-black text-white font-display">
                  {result.message}
                </h3>

                {result.ticket && (
                  <div className="pt-3 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Attendee Name</span>
                      <span className="font-bold text-white text-sm">{result.ticket.buyer_name || 'Guest'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Category</span>
                      <span className={`font-bold flex items-center gap-1 ${
                        result.ticket.category === 'VIP' ? 'text-cyan-400' : 'text-amber-400'
                      }`}>
                        {result.ticket.category === 'VIP' && <Crown className="w-3.5 h-3.5" />}
                        {result.ticket.category} Pass
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Payment Status</span>
                      <span className="font-bold uppercase text-white">{result.ticket.payment_status}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Phone</span>
                      <span className="font-mono text-slate-300">{result.ticket.buyer_phone || 'N/A'}</span>
                    </div>
                  </div>
                )}

                {result.ticket && (
                  <div className="pt-3 flex justify-end">
                    <button
                      onClick={() => onViewTicket(result.ticket!)}
                      className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg cursor-pointer"
                    >
                      View Ticket Card Template
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Recent Check-Ins Log */}
        <div className="bg-[#070e1b] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-cyan-400" />
              <span>Recent Admitted Guests (Audit Trail)</span>
            </h4>
            <button
              onClick={loadRecent}
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Log</span>
            </button>
          </div>

          {recentScans.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No check-ins recorded yet.</p>
          ) : (
            <div className="divide-y divide-white/5 text-xs">
              {recentScans.map((scan) => (
                <div key={scan.id} className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-cyan-300">{scan.ticket_number}</span>
                    <span className="font-semibold text-white">{scan.buyer_name || 'Guest'}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      scan.category === 'VIP' ? 'bg-cyan-950 text-cyan-300' : 'bg-amber-950 text-amber-300'
                    }`}>
                      {scan.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      {scan.checked_in_at ? new Date(scan.checked_in_at).toLocaleTimeString() : 'Just now'}
                    </span>
                    <button
                      onClick={() => onViewTicket(scan)}
                      className="text-amber-400 hover:underline"
                    >
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
