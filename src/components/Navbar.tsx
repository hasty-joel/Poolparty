import React, { useState } from 'react';
import { Ticket, Phone, Lock, QrCode, Menu, X } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

interface NavbarProps {
  onTicketClick: () => void;
  onOpenAdmin: () => void;
  onOpenScanner: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  onTicketClick, 
  onOpenAdmin, 
  onOpenScanner 
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-[#080c14]/95 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-8">
        
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="flex items-center gap-3 whitespace-nowrap shrink-0 group"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400 font-bold text-sm font-display">
            PR
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold leading-none">
              Prince Resort Bunamwaya
            </span>
            <span className="text-lg font-black tracking-tight text-white font-display leading-tight group-hover:text-amber-300 transition-colors">
              POOL PARTY
            </span>
          </div>
        </a>

        {/* Zone 2: Navigation Links (Desktop) */}
        <nav className="hidden lg:flex items-center gap-7 text-xs font-semibold text-slate-300 tracking-wider uppercase">
          <a
            href="#lineup"
            className="hover:text-white transition-colors whitespace-nowrap py-1"
          >
            Lineup & Activities
          </a>
          <a
            href="#tickets"
            className="hover:text-white transition-colors whitespace-nowrap py-1"
          >
            Tickets
          </a>
          <a
            href="#location"
            className="hover:text-white transition-colors whitespace-nowrap py-1"
          >
            Prince Resort
          </a>
          <button
            onClick={onOpenScanner}
            className="hover:text-cyan-300 transition-colors whitespace-nowrap flex items-center gap-1.5 text-slate-300 cursor-pointer py-1"
          >
            <QrCode className="w-3.5 h-3.5 text-cyan-400" />
            <span>Gate Scanner</span>
          </button>
          <button
            onClick={onOpenAdmin}
            className="hover:text-amber-300 transition-colors whitespace-nowrap flex items-center gap-1.5 text-slate-300 cursor-pointer py-1"
          >
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span>Admin</span>
          </button>
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <a
            href={`tel:${EVENT_DATA.rsvpTel}`}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors whitespace-nowrap"
          >
            <Phone className="w-3.5 h-3.5 text-amber-400" />
            <span>RSVP: {EVENT_DATA.rsvpPhone}</span>
          </a>

          <button
            onClick={onTicketClick}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold tracking-wider text-slate-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 transition-colors rounded-lg shadow-sm whitespace-nowrap cursor-pointer uppercase font-display"
          >
            <Ticket className="w-3.5 h-3.5" />
            <span>Get Tickets</span>
          </button>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 text-slate-300 hover:text-white rounded-lg hover:bg-white/5"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-white/10 bg-[#080c14] px-4 py-4 space-y-3">
          <a
            href="#lineup"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white py-2"
          >
            Lineup & Activities
          </a>
          <a
            href="#tickets"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white py-2"
          >
            Tickets (Ordinary 20K / VIP 50K)
          </a>
          <a
            href="#location"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white py-2"
          >
            Venue: Prince Resort Bunamwaya
          </a>
          <div className="pt-2 border-t border-white/10 flex items-center justify-between">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenScanner();
              }}
              className="text-xs font-bold uppercase text-cyan-300 flex items-center gap-1.5 py-1"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Gate Scanner</span>
            </button>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAdmin();
              }}
              className="text-xs font-bold uppercase text-amber-300 flex items-center gap-1.5 py-1"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Staff Admin</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
