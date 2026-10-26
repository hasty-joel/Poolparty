import React from 'react';
import { Ticket, Phone, Crown } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

interface NavbarProps {
  onTicketClick: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onTicketClick }) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-[#030712]/90 backdrop-blur-md border-b border-amber-500/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-4">
        {/* Zone 1: Brand wordmark & Prince Resort badge */}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="flex items-center gap-2 group whitespace-nowrap shrink-0"
        >
          <Crown className="w-5 h-5 text-amber-400 group-hover:rotate-6 transition-transform" />
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-widest text-amber-300 font-bold leading-none">
              Prince Resort
            </span>
            <span className="text-lg sm:text-xl font-black tracking-tight text-white font-display group-hover:text-cyan-300 transition-colors leading-tight">
              POOL PARTY
            </span>
          </div>
        </a>

        {/* Zone 2: Navigation / Key Quick Info */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-300 tracking-wide uppercase">
          <a
            href="#lineup"
            className="hover:text-amber-300 transition-colors whitespace-nowrap"
          >
            Lineup & Activities
          </a>
          <a
            href="#tickets"
            className="hover:text-amber-300 transition-colors whitespace-nowrap"
          >
            Tickets (20K / 50K)
          </a>
          <a
            href="#location"
            className="hover:text-amber-300 transition-colors whitespace-nowrap"
          >
            Prince Resort
          </a>
        </nav>

        {/* Zone 3: RSVP phone and Tickets CTA */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <a
            href={`tel:${EVENT_DATA.rsvpTel}`}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-300 hover:text-white bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/30 rounded-lg transition-colors whitespace-nowrap"
          >
            <Phone className="w-3.5 h-3.5 text-amber-400" />
            <span>RSVP {EVENT_DATA.rsvpPhone}</span>
          </a>

          <button
            onClick={onTicketClick}
            className="inline-flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 text-xs font-bold tracking-wider text-slate-950 bg-gradient-to-r from-amber-400 via-amber-300 to-cyan-400 hover:from-amber-300 hover:to-cyan-300 transition-all rounded-lg shadow-sm active:scale-98 whitespace-nowrap cursor-pointer uppercase"
          >
            <Ticket className="w-3.5 h-3.5" />
            <span>Get Tickets</span>
          </button>
        </div>
      </div>
    </header>
  );
};
