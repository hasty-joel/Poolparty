import React, { useState, useEffect, useCallback } from 'react';
import { 
  QrCode, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Search, 
  RefreshCw, 
  UserCheck, 
  ArrowLeft,
  Crown,
  Lock,
  LogOut,
  ShieldCheck
} from 'lucide-react';
import { TicketService } from '../../lib/ticketService';
import { CheckInResult, TicketCategory, TicketRecord } from '../../types/inventory';

interface GateScannerProps {
  onBack: () => void;
  onViewTicket?: (ticket: TicketRecord) => void;
}

interface RecentGateCheckInItem {
  id: string;
  ticket_number: string;
  category: TicketCategory;
  buyer_name: string | null;
  checked_in_at: string | null;
  ticket_channel?: 'online' | 'hardcopy';
}

export const GateScanner: React.FC<GateScannerProps> = ({ onBack }) => {
  const [checkingSession, setCheckingSession] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [staffRole, setStaffRole] = useState<'gate_staff' | 'admin' | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);

  const [gatePasscode, setGatePasscode] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [inputCode, setInputCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [recentScans, setRecentScans] = useState<RecentGateCheckInItem[]>([]);

  const loadRecent = useCallback(async () => {
    try {
      const res = await TicketService.getRecentGateCheckIns(8);
      if (res.unauthorized) {
        setIsAuthenticated(false);
        setStaffRole(null);
        setLoginError('Gate staff session expired. Please sign in again.');
        return;
      }
      if (res.success && Array.isArray(res.checkIns)) {
        setRecentScans(res.checkIns);
      }
    } catch {
      // ignore transient feed error
    }
  }, []);

  useEffect(() => {
    let active = true;
    TicketService.checkGateSession()
      .then((session) => {
        if (!active) return;
        if (session.authenticated) {
          setIsAuthenticated(true);
          setStaffRole(session.role || 'gate_staff');
          setSessionExpiresAt(session.expiresAt || null);
        } else {
          setIsAuthenticated(false);
          setStaffRole(null);
        }
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadRecent();
    }
  }, [isAuthenticated, result, loadRecent]);

  const handleGateLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gatePasscode.trim() || isLoggingIn) return;

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const res = await TicketService.loginGateSession(gatePasscode.trim());
      if (res.success && res.authenticated) {
        setGatePasscode('');
        setIsAuthenticated(true);
        setStaffRole(res.role || 'gate_staff');
        setSessionExpiresAt(res.expiresAt || null);
        setResult(null);
      } else {
        setLoginError(res.message || 'Invalid gate staff passcode.');
      }
    } catch {
      setLoginError('Network error signing into gate checkpoint.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await TicketService.logoutGateSession();
    setIsAuthenticated(false);
    setStaffRole(null);
    setSessionExpiresAt(null);
    setResult(null);
    setRecentScans([]);
  };

  const handleVerify = async (codeToVerify?: string) => {
    const target = (codeToVerify || inputCode).trim();
    if (!target) return;

    setIsVerifying(true);
    setResult(null);

    let cleanToken = target;
    if (target.includes('verify=')) {
      const match = target.match(/[?&]verify=([^&#\s]+)/i) || target.match(/verify=([^&#\s]+)/i);
      if (match && match[1]) {
        try {
          cleanToken = decodeURIComponent(match[1]);
        } catch {
          cleanToken = match[1];
        }
      }
    }

    try {
      const res = await TicketService.verifyAndCheckIn(cleanToken);
      if (res.status === 'UNAUTHORIZED') {
        setIsAuthenticated(false);
        setStaffRole(null);
        setLoginError(res.message || 'Gate staff session expired. Please sign in again.');
        return;
      }
      setResult(res);
      if (res.status === 'ADMITTED') {
        setInputCode('');
      }
    } catch {
      setResult({
        status: 'INVALID',
        message: 'Network error during verification. Check server connection.',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 flex items-center justify-center p-4">
        <div className="flex items-center gap-2.5 text-xs text-slate-300">
          <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
          <span>Checking gate checkpoint session...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 flex items-center justify-center p-3 sm:p-4">
        <div className="w-full max-w-md bg-[#0d1522] border border-white/10 rounded-xl sm:rounded-2xl p-5 sm:p-8 shadow-2xl space-y-5">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-400/20 text-cyan-300 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>

          <div className="text-center">
            <h1 className="text-xl font-bold text-white font-display">
              Gate Staff Checkpoint Sign-In
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Authorized gate staff credentials are required to check passes in at Prince Resort Bunamwaya.
            </p>
          </div>

          {loginError && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-lg text-xs text-rose-300">
              {loginError}
            </div>
          )}

          <form onSubmit={handleGateLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Gate Staff Passcode
              </label>
              <input
                type="password"
                value={gatePasscode}
                onChange={(e) => setGatePasscode(e.target.value)}
                placeholder="Enter gate staff passcode"
                className="w-full px-3.5 sm:px-4 py-3 bg-[#080c14] border border-white/15 rounded-lg text-white text-base sm:text-sm min-h-[46px] focus:outline-none focus:border-cyan-400 font-mono transition-colors"
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn || !gatePasscode.trim()}
              className="w-full min-h-[46px] py-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold rounded-lg text-xs uppercase tracking-wider shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              {isLoggingIn ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Unlock Gate Scanner</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
            <span>Pool Gate 1 · Staff Only</span>
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
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <button
              onClick={onBack}
              className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Return to Main Website"
            >
              <ArrowLeft className="w-5 h-5 text-amber-400" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-white font-display truncate">
                Gate Entry Scanner
              </h1>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Prince Resort Bunamwaya · Single-Scan QR Token Verification
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-[11px] sm:text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 font-mono">
              {staffRole === 'admin' ? 'Admin Session' : 'Gate Staff'}
              {sessionExpiresAt ? ` · Exp ${new Date(sessionExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-lg border border-white/10 flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Verification Input Box */}
        <div className="bg-[#0d1522] border border-white/10 rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 shadow-lg">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
            Scan Barcode / QR Code, Paste Verification URL, or Enter Ticket Number
          </label>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleVerify();
            }}
            className="flex flex-col sm:flex-row gap-2.5 sm:gap-3"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                placeholder="Scan QR token UUID or type ticket number (e.g. VIP-001, ORD-051)"
                className="w-full px-3.5 py-3 pl-10 bg-[#080c14] border border-white/15 rounded-lg text-white text-base sm:text-sm font-mono placeholder-slate-500 min-h-[46px] focus:outline-none focus:border-amber-400 transition-colors"
                autoFocus
              />
              <QrCode className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>

            <button
              type="submit"
              disabled={isVerifying || !inputCode.trim()}
              className="w-full sm:w-auto min-h-[46px] px-6 py-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center gap-2"
            >
              {isVerifying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 shrink-0" />
                  <span>Check In Pass</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Verification Result Card */}
        {result && (
          <div
            className={`p-6 sm:p-7 rounded-2xl border transition-colors shadow-lg ${
              result.status === 'ADMITTED'
                ? 'bg-emerald-950/30 border-emerald-500/50'
                : result.status === 'ALREADY_USED'
                ? 'bg-rose-950/30 border-rose-500/50'
                : result.status === 'UNPAID'
                ? 'bg-amber-950/30 border-amber-500/50'
                : 'bg-red-950/30 border-red-500/50'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="shrink-0 mt-0.5">
                {result.status === 'ADMITTED' && (
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                )}
                {result.status === 'ALREADY_USED' && (
                  <XCircle className="w-10 h-10 text-rose-400" />
                )}
                {result.status === 'UNPAID' && (
                  <AlertTriangle className="w-10 h-10 text-amber-400" />
                )}
                {(result.status === 'CANCELLED' || result.status === 'INVALID' || result.status === 'NOT_ISSUED') && (
                  <XCircle className="w-10 h-10 text-rose-400" />
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded ${
                      result.status === 'ADMITTED'
                        ? 'bg-emerald-400 text-slate-950'
                        : result.status === 'ALREADY_USED'
                        ? 'bg-rose-500 text-white'
                        : result.status === 'UNPAID'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-red-600 text-white'
                    }`}
                  >
                    {result.status.replace('_', ' ')}
                  </span>

                  {result.ticket && (
                    <span className="text-xs font-mono font-bold text-slate-300">
                      Pass #{result.ticket.ticket_number}
                    </span>
                  )}
                </div>

                <h3 className="text-lg sm:text-xl font-bold text-white font-display">
                  {result.message}
                </h3>

                {result.ticket && (
                  <div className="pt-3 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Attendee Name</span>
                      <span className="font-semibold text-white">{result.ticket.buyer_name || 'Walk-up / Guest'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Category</span>
                      <span className={`font-semibold flex items-center gap-1 ${
                        result.ticket.category === 'VIP' ? 'text-cyan-400' : 'text-amber-400'
                      }`}>
                        {result.ticket.category === 'VIP' && <Crown className="w-3.5 h-3.5" />}
                        {result.ticket.category} Pass
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Payment Status</span>
                      <span className="font-semibold uppercase text-white">{result.ticket.payment_status}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Channel</span>
                      <span className="font-mono uppercase text-slate-300">
                        {result.ticket.ticket_channel === 'hardcopy' ? 'Hardcopy' : 'Online'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Recent Check-Ins Log */}
        <div className="bg-[#0d1522] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-amber-400" />
              <span>Recent Admitted Guests (Gate Feed)</span>
            </h4>
            <button
              onClick={loadRecent}
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>

          {recentScans.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No admissions logged yet.</p>
          ) : (
            <div className="divide-y divide-white/5 text-xs">
              {recentScans.map((scan) => (
                <div key={scan.id} className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-cyan-300">{scan.ticket_number}</span>
                    <span className="font-medium text-white">{scan.buyer_name || 'Guest'}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      scan.category === 'VIP' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {scan.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400">
                    <span className="flex items-center gap-1 text-[11px]">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      {scan.checked_in_at ? new Date(scan.checked_in_at).toLocaleTimeString() : 'Just now'}
                    </span>
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

