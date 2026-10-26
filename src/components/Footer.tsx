import React from 'react';
import { Phone, ArrowUp } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

export const Footer: React.FC = () => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-[#05080e] border-t border-white/10 text-slate-400 text-xs py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-8 border-b border-white/10 text-center md:text-left">
          
          {/* Brand */}
          <div>
            <span className="text-sm font-bold text-white tracking-wide font-display block">
              Prince Resort Bunamwaya (Bella)
            </span>
            <p className="text-xs text-slate-400 mt-0.5">
              POOL PARTY · Friday, 11 December 2026 · From 12:00 PM till late
            </p>
          </div>

          {/* Quick Details */}
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-300">
            <span className="text-slate-200">Ordinary: UGX 20,000</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-amber-300">VIP: UGX 50,000</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <a
              href={`tel:${EVENT_DATA.rsvpTel}`}
              className="text-white hover:text-amber-300 font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Phone className="w-3.5 h-3.5 text-amber-400" />
              <span>RSVP: {EVENT_DATA.rsvpPhone}</span>
            </a>
          </div>

          {/* Back to top */}
          <button
            onClick={scrollToTop}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <span>Back to Top</span>
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500 text-center sm:text-left">
          <p>© 2026 POOL PARTY · Prince Resort, Bunamwaya Bella, Uganda.</p>
          <p>Hosted by Trevor DJ · Strictly 18+ · Official Relworx Ticketing</p>
        </div>
      </div>
    </footer>
  );
};
