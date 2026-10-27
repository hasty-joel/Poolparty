import React, { useState } from 'react';
import { X, Search, CheckCircle2, AlertCircle, RefreshCw, ShieldCheck, Crown } from 'lucide-react';
import { TicketService } from '../../lib/ticketService';
import { LookupTicketSummary, TicketRecord } from '../../types/inventory';

interface TicketLookupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTicket?: (ticket: TicketRecord) => void;
}

export const TicketLookupModal: React.FC<TicketLookupModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [contact, setContact] = useState('');
  const [verification, setVerification] = useState('');
  const [loading, setLoading] = useState(false);
  const [foundTickets, setFoundTickets] = useState<LookupTicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact.trim() || !verification.trim()) return;

    setLoading(true);
    setError(null);
    setFoundTickets(null);

    try {
      const res = await TicketService.lookupTickets(contact.trim(), verification.trim());
      if (!res.success) {
        setError(res.message || 'Please check your order details and ownership verification.');
        return;
      }
      if (res.tickets && res.tickets.length > 0) {
        setFoundTickets(res.tickets);
      } else {
        setError(
          res.message ||
            'No confirmed tickets matched the provided details. Please verify the phone/order reference and checkout email.'
        );
      }
    } catch (err: any) {
      setError(err?.message || 'Error searching for ticket.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 xs:p-3 sm:p-6 overflow-y-auto bg-black/85 backdrop-blur-sm">
      <div 
        className="relative w-full max-w-lg bg-[#0d1522] border border-white/15 rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[94vh]"
        role="dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 bg-[#080c14] border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-amber-400 shrink-0" />
            <h3 className="text-sm sm:text-base font-bold text-white font-display">
              Verify My Purchased Order
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto max-h-[calc(94vh-65px)]">
          <p className="text-xs text-slate-400 leading-relaxed">
            Enter your checkout phone number (e.g. <span className="font-mono text-slate-300">0775 198 484</span>) or exact order reference (e.g. <span className="font-mono text-slate-300">PP-MTN-...</span> or <span className="font-mono text-slate-300">PP-RWX-...</span>), plus your checkout email address to verify ownership.
          </p>

          <form onSubmit={handleSearch} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Phone Number or Exact Order Reference
              </label>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="e.g. 0775 198 484 or PP-MTN-..."
                className="w-full px-3.5 py-3 bg-[#080c14] border border-white/15 rounded-lg text-white text-base sm:text-sm min-h-[46px] focus:border-amber-400 focus:outline-none transition-colors font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Ownership Verification (Checkout Email or Matching Order Ref)
              </label>
              <input
                type="text"
                value={verification}
                onChange={(e) => setVerification(e.target.value)}
                placeholder="e.g. name@example.com"
                className="w-full px-3.5 py-3 bg-[#080c14] border border-white/15 rounded-lg text-white text-base sm:text-sm min-h-[46px] focus:border-amber-400 focus:outline-none transition-colors"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || !contact.trim() || !verification.trim()}
              className="w-full min-h-[44px] py-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold rounded-lg text-xs uppercase tracking-wider shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              {loading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>{loading ? 'Verifying Order...' : 'Verify My Passes'}</span>
            </button>
          </form>

          {error && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-lg text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {foundTickets && foundTickets.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Verified {foundTickets.length} confirmed pass(es)</span>
              </div>

              <div className="space-y-2">
                {foundTickets.map((t) => (
                  <div
                    key={t.ticket_number}
                    className="p-3 sm:p-3.5 rounded-xl bg-[#080c14] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                        t.category === 'VIP' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-slate-800 text-slate-300'
                      }`}>
                        {t.category === 'VIP' && <Crown className="w-3 h-3" />}
                        <span>{t.category} Pass · #{t.ticket_number}</span>
                      </span>
                      <h4 className="text-sm font-semibold text-white mt-1">
                        {t.buyer_name || 'Confirmed Guest'}
                      </h4>
                      {t.order_ref && (
                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                          Order: {t.order_ref}
                        </p>
                      )}
                    </div>

                    <div className="text-left sm:text-right text-xs space-y-0.5">
                      <span className="inline-block px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 text-[10px] font-bold uppercase">
                        {t.payment_status === 'manual_paid' ? 'Paid (Verified)' : 'Paid & Issued'}
                      </span>
                      <p className={`text-[11px] font-semibold ${t.checked_in_at ? 'text-rose-400' : 'text-cyan-300'}`}>
                        {t.checked_in_at ? 'Already Checked In' : 'Valid · Unused at Gate'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 text-[11px] text-slate-400 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  For attendee security, cryptographic QR tokens are never exposed in public lookup responses. Use the official PDF pass downloaded at checkout or sent via organizer WhatsApp delivery.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

