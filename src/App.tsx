/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { LineupAndVibe } from './components/LineupAndVibe';
import { TicketPurchase } from './components/TicketPurchase';
import { VenueAndRsvp } from './components/VenueAndRsvp';
import { Footer } from './components/Footer';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { GateScanner } from './components/scanner/GateScanner';
import { TicketViewerModal } from './components/ticket/TicketViewerModal';
import { PublicTicketVerifyPage } from './components/ticket/PublicTicketVerifyPage';
import { FlyerModal } from './components/FlyerModal';
import { TicketRecord } from './types/inventory';

type AppView = 'public' | 'admin' | 'scanner' | 'verify';

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('public');
  const [verifyToken, setVerifyToken] = useState<string>('');
  const [activeTicket, setActiveTicket] = useState<TicketRecord | null>(null);
  const [flyerModalOpen, setFlyerModalOpen] = useState(false);

  // Check URL query parameters for direct routing (?verify=<uuid> -> public read-only validity page; ?admin=true -> admin login)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('verify');
    if (tokenParam && tokenParam.trim()) {
      setVerifyToken(tokenParam.trim());
      setCurrentView('verify');
    } else if (params.get('admin') === 'true') {
      setCurrentView('admin');
    }
  }, []);

  const clearVerifyUrlAndGo = (nextView: AppView) => {
    if (window.location.search.includes('verify=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setCurrentView(nextView);
  };

  const scrollToTickets = () => {
    if (currentView !== 'public') {
      setCurrentView('public');
      setTimeout(() => {
        const el = document.getElementById('tickets');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return;
    }
    const el = document.getElementById('tickets');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Public read-only QR pass validity check (?verify=<qr_token>)
  if (currentView === 'verify') {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200">
        <PublicTicketVerifyPage
          token={verifyToken}
          onBack={() => clearVerifyUrlAndGo('public')}
          onOpenStaffScanner={() => clearVerifyUrlAndGo('scanner')}
        />
      </div>
    );
  }

  // If Admin View is active
  if (currentView === 'admin') {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 selection:bg-amber-400/30 selection:text-amber-200">
        <AdminDashboard
          onBack={() => setCurrentView('public')}
          onOpenGateScanner={() => setCurrentView('scanner')}
          onViewTicket={(ticket) => setActiveTicket(ticket)}
        />
        {/* Ticket Viewer & PDF Modal */}
        <TicketViewerModal
          ticket={activeTicket}
          onClose={() => setActiveTicket(null)}
        />
      </div>
    );
  }

  // If Gate Scanner View is active
  if (currentView === 'scanner') {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200">
        <GateScanner
          onBack={() => setCurrentView('public')}
          onViewTicket={(ticket) => setActiveTicket(ticket)}
        />
        {/* Ticket Viewer & PDF Modal */}
        <TicketViewerModal
          ticket={activeTicket}
          onClose={() => setActiveTicket(null)}
        />
      </div>
    );
  }

  // Public Event Website View
  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 selection:bg-amber-400/30 selection:text-amber-200">
      {/* Navigation Bar with Admin & Scanner Triggers */}
      <Navbar
        onTicketClick={scrollToTickets}
        onOpenAdmin={() => setCurrentView('admin')}
        onOpenScanner={() => setCurrentView('scanner')}
      />

      {/* Main Single Page Content */}
      <main>
        {/* Hero Section referencing Poster, Host, and 20K/50K Tiers */}
        <Hero
          onGetTicket={scrollToTickets}
          onViewFlyer={() => setFlyerModalOpen(true)}
        />

        {/* Confirmed Lineup & Activities from Poster */}
        <LineupAndVibe />

        {/* Live Inventory Ticket Purchase (Ordinary 20K / VIP 50K) */}
        <TicketPurchase
          onContinueToPayment={(createdTicket) => setActiveTicket(createdTicket)}
        />

        {/* Venue Location & RSVP Contact Strip */}
        <VenueAndRsvp />
      </main>

      {/* Clean Minimal Footer */}
      <Footer />

      {/* Ticket Viewer & PDF Modal */}
      <TicketViewerModal
        ticket={activeTicket}
        onClose={() => setActiveTicket(null)}
      />

      {/* Full Poster Lightbox Modal */}
      <FlyerModal
        isOpen={flyerModalOpen}
        onClose={() => setFlyerModalOpen(false)}
      />
    </div>
  );
}
