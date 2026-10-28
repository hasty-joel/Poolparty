import React, { useState } from 'react';
import { Ticket, Phone, Lock, QrCode, Menu, X } from 'lucide-react';
import { EVENT_DATA } from '../types/event';
import { PoolPartyLogo } from './brand/PoolPartyLogo';

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
      <div className="w-full max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 h-15 sm:h-18 flex items-center justify-between gap-1.5 sm:gap-4 lg:gap-8">
        
        {/* Zone 1: Brand Wordmark & Official Logo */}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="flex items-center gap-1.5 sm:gap-3 min-w-0 shrink group"
          aria-label="POOL PARTY at Prince Resort Bunamwaya"
        >
          <PoolPartyLogo variant="full" size="md" />
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
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <a
            href={`tel:${EVENT_DATA.rsvpTel}`}
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors whitespace-nowrap"
          >
            <Phone className="w-3.5 h-3.5 text-amber-400" />
            <span>RSVP: {EVENT_DATA.rsvpPhone}</span>
          </a>

          <button
            onClick={onTicketClick}
            className="inline-flex items-center gap-1 sm:gap-2 px-2.5 sm:px-5 py-2 sm:py-2.5 text-[10.5px] sm:text-xs font-bold tracking-wider text-slate-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 transition-colors rounded-lg shadow-sm whitespace-nowrap cursor-pointer uppercase font-display min-h-[38px] sm:min-h-[42px]"
          >
            <Ticket className="w-3.5 h-3.5 shrink-0" />
            <span>Get Tickets</span>
          </button>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden shrink-0 inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 text-slate-200 hover:text-white rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-4 h-4 sm:w-5 sm:h-5" /> : <Menu className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-white/10 bg-[#080c14] px-4 py-4 space-y-3">
          <a
            href="#lineup"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white py-2.5 min-h-[44px] flex items-center"
          >
            Lineup & Activities
          </a>
          <a
            href="#tickets"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white py-2.5 min-h-[44px] flex items-center"
          >
            Tickets (Ordinary 20K / VIP 50K)
          </a>
          <a
            href="#location"
            onClick={() => setMobileMenuOpen(false)}
            className="block text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white py-2.5 min-h-[44px] flex items-center"
          >
            Venue: Prince Resort Bunamwaya
          </a>
          <a
            href={`tel:${EVENT_DATA.rsvpTel}`}
            onClick={() => setMobileMenuOpen(false)}
            className="block text-xs font-bold uppercase tracking-wider text-amber-300 hover:text-amber-200 py-2.5 min-h-[44px] flex items-center gap-2"
          >
            <Phone className="w-3.5 h-3.5 text-amber-400" />
            <span>Direct RSVP: {EVENT_DATA.rsvpPhone}</span>
          </a>
          <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-3">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenScanner();
              }}
              className="text-xs font-bold uppercase text-cyan-300 flex items-center gap-1.5 py-2.5 min-h-[44px] cursor-pointer"
            >
              <QrCode className="w-4 h-4" />
              <span>Gate Scanner</span>
            </button>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAdmin();
              }}
              className="text-xs font-bold uppercase text-amber-300 flex items-center gap-1.5 py-2.5 min-h-[44px] cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>Staff Admin</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
