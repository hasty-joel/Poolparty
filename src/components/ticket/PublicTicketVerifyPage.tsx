import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  ArrowLeft,
  QrCode,
  Crown,
} from 'lucide-react';
import { TicketService } from '../../lib/ticketService';
import { PublicTicketValidityResult } from '../../types/inventory';

interface PublicTicketVerifyPageProps {
  token: string;
  onBack: () => void;
  onOpenStaffScanner: () => void;
}

export const PublicTicketVerifyPage: React.FC<PublicTicketVerifyPageProps> = ({
  token,
  onBack,
  onOpenStaffScanner,
}) => {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<PublicTicketValidityResult | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    TicketService.getPublicTicketStatus(token)
      .then((res) => {
        if (active) setResult(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  const status = result?.status || 'INVALID';
  const isValidUnused = status === 'VALID_UNUSED';
  const isInactive = status === 'INACTIVE';
  const isAlreadyUsed = status === 'ALREADY_USED';

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col justify-between p-4 sm:p-8">
      <div className="max-w-xl w-full mx-auto space-y-6 my-auto">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <button
            onClick={onBack}
            className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-semibold text-slate-200 flex items-center gap-2 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-amber-400" />
            <span>Event Website</span>
          </button>

          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <span>Read-Only Pass Check</span>
          </span>
        </div>

        <div className="bg-[#0d1522] border border-white/15 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-xs text-slate-300">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
              <span>Checking official Pool Party pass status...</span>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-4">
                <div className="shrink-0 mt-0.5">
                  {isValidUnused ? (
                    <CheckCircle2 className="w-11 h-11 text-emerald-400" />
                  ) : isInactive ? (
                    <AlertTriangle className="w-11 h-11 text-amber-400" />
                  ) : (
                    <XCircle className="w-11 h-11 text-rose-400" />
                  )}
                </div>

                <div className="space-y-2 flex-1">
                  <span
                    className={`inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded ${
                      isValidUnused
                        ? 'bg-emerald-400 text-slate-950'
                        : isInactive
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-rose-600 text-white'
                    }`}
                  >
                    {isValidUnused
                      ? 'Valid & Unused'
                      : isInactive
                      ? 'Inactive / Unpaid'
                      : isAlreadyUsed
                      ? 'Already Used'
                      : status === 'CANCELLED'
                      ? 'Cancelled / Voided'
                      : 'Invalid Pass'}
                  </span>

                  <h1 className="text-xl sm:text-2xl font-bold text-white font-display">
                    {result?.message || 'Unable to verify pass status.'}
                  </h1>
                </div>
              </div>

              {result?.ticketNumber && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-[#080c14] border border-white/10 text-xs">
                  <div>
                    <span className="text-[10px] uppercase text-slate-400 block">Pass Number</span>
                    <span className="font-mono font-bold text-white text-sm">{result.ticketNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-slate-400 block">Tier</span>
                    <span
                      className={`font-bold inline-flex items-center gap-1 text-sm ${
                        result.category === 'VIP' ? 'text-cyan-300' : 'text-amber-300'
                      }`}
                    >
                      {result.category === 'VIP' && <Crown className="w-3.5 h-3.5" />}
                      <span>{result.category}</span>
                    </span>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <span className="text-[10px] uppercase text-slate-400 block">Channel</span>
                    <span className="font-mono uppercase text-slate-200 text-sm">
                      {result.channel === 'hardcopy' ? 'Hardcopy Pass' : 'Online Pass'}
                    </span>
                  </div>
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-500/30 text-xs text-cyan-100 leading-relaxed">
                <strong>Safe Read-Only Check:</strong> Scanning this link as a guest does <strong>not</strong> mark your pass as used. Present your QR code at the Prince Resort Bunamwaya gate for authorized staff check-in.
              </div>

              <div className="pt-2 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={onBack}
                  className="w-full sm:w-auto px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-lg cursor-pointer transition-colors"
                >
                  Return to Pool Party 2026
                </button>

                <button
                  type="button"
                  onClick={onOpenStaffScanner}
                  className="w-full sm:w-auto px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/15 text-slate-300 hover:text-white font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <QrCode className="w-4 h-4 text-cyan-400" />
                  <span>Gate Staff Checkpoint Sign-In</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
