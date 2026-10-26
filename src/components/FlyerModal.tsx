import React from 'react';
import { X, Phone } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

interface FlyerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FlyerModal: React.FC<FlyerModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-black/80 backdrop-blur-sm">
      <div className="relative max-w-lg w-full bg-[#0d1522] border border-white/15 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#080c14] border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
              Official Event Poster
            </span>
            <span className="text-slate-500 text-xs">·</span>
            <span className="text-xs text-slate-300">Prince Resort Bunamwaya Bella</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Poster Viewer */}
        <div className="overflow-y-auto p-4 flex justify-center bg-[#080c14]">
          <img
            src={EVENT_DATA.flyerImage}
            alt="Official Luxury Tropical Pool Party Poster - Prince Resort Bunamwaya Bella"
            className="w-full h-auto rounded-lg border border-white/10 object-contain shadow-md"
          />
        </div>

        {/* Footer info & RSVP */}
        <div className="px-5 py-3 bg-[#080c14] border-t border-white/10 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Phone className="w-3.5 h-3.5 text-amber-400" />
            <span>RSVP: <strong>{EVENT_DATA.rsvpPhone}</strong></span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg text-xs uppercase cursor-pointer transition-colors"
          >
            Close Poster
          </button>
        </div>
      </div>
    </div>
  );
};
