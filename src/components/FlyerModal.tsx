import React from 'react';
import { X, Download, Phone, MapPin } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

interface FlyerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FlyerModal: React.FC<FlyerModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-black/90 backdrop-blur-md">
      <div className="relative max-w-lg w-full bg-[#070e1b] border-2 border-amber-400/50 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#030712] border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
              Official Event Poster
            </span>
            <span className="text-slate-400 text-xs">·</span>
            <span className="text-xs text-white">Prince Resort Bunamwaya</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Poster Viewer */}
        <div className="overflow-y-auto p-2 flex justify-center bg-[#02050b]">
          <img
            src={EVENT_DATA.flyerImage}
            alt="Official Luxury Tropical Pool Party Poster - Prince Resort Bunamwaya Bella"
            className="w-full h-auto rounded-lg shadow-lg object-contain"
          />
        </div>

        {/* Footer info & RSVP */}
        <div className="px-4 py-3 bg-[#030712] border-t border-white/10 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Phone className="w-3.5 h-3.5 text-amber-400" />
            <span>RSVP: <strong>{EVENT_DATA.rsvpPhone}</strong></span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-400 text-slate-950 font-bold rounded-lg text-xs uppercase"
          >
            Close Poster
          </button>
        </div>
      </div>
    </div>
  );
};
