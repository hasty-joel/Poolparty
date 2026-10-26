import React, { useState } from 'react';
import { X, Search, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { TicketService } from '../../lib/ticketService';
import { TicketRecord } from '../../types/inventory';

interface TicketLookupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTicket: (ticket: TicketRecord) => void;
}

export const TicketLookupModal: React.FC<TicketLookupModalProps> = ({
  isOpen,
  onClose,
  onSelectTicket,
}) => {
  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);
  const [foundTickets, setFoundTickets] = useState<TicketRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact.trim()) return;

    setLoading(true);
    setError(null);
    setFoundTickets(null);

    try {
      const res = await TicketService.lookupTickets(contact.trim());
      if (res.success && res.tickets && res.tickets.length > 0) {
        setFoundTickets(res.tickets);
      } else {
        setError('No issued tickets found for this phone number or order reference. Please check the number used during checkout.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error searching for ticket.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-black/80 backdrop-blur-sm">
      <div 
        className="relative w-full max-w-lg bg-[#0d1522] border border-white/15 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
        role="dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#080c14] border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm sm:text-base font-bold text-white font-display">
              Retrieve My Purchased Tickets
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

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            Enter the phone number you entered at checkout (e.g. <span className="font-mono text-slate-300">0775...</span>) or your order reference (e.g. <span className="font-mono text-slate-300">PP-RWX-...</span>).
          </p>

          <form onSubmit={handleSearch} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Phone Number or Order Reference
              </label>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="e.g. 0775 198 484 or PP-RWX-..."
                className="w-full px-4 py-2.5 bg-[#080c14] border border-white/15 rounded-lg text-white text-sm focus:border-amber-400 focus:outline-none transition-colors"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || !contact.trim()}
              className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-lg text-xs uppercase tracking-wider shadow-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              {loading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>{loading ? 'Searching...' : 'Find My Tickets'}</span>
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
                <span>Found {foundTickets.length} confirmed pass(es)</span>
              </div>

              <div className="space-y-2">
                {foundTickets.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => {
                      onSelectTicket(t);
                      onClose();
                    }}
                    className="p-3.5 rounded-xl bg-[#080c14] border border-white/10 hover:border-amber-400/60 flex items-center justify-between cursor-pointer transition-colors group"
                  >
                    <div>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                        t.category === 'VIP' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-slate-800 text-slate-300'
                      }`}>
                        {t.category} Pass · #{t.ticket_number}
                      </span>
                      <h4 className="text-sm font-semibold text-white mt-1 group-hover:text-amber-300">
                        {t.buyer_name}
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Status: {t.payment_status}
                      </p>
                    </div>

                    <button className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-bold group-hover:bg-amber-300 transition-colors">
                      View & Download
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
