/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { LineupAndVibe } from './components/LineupAndVibe';
import { TicketPurchase } from './components/TicketPurchase';
import { VenueAndRsvp } from './components/VenueAndRsvp';
import { Footer } from './components/Footer';
import { DemoCheckoutModal } from './components/DemoCheckoutModal';
import { FlyerModal } from './components/FlyerModal';
import { ReservationOrder } from './types/event';

export default function App() {
  const [activeOrder, setActiveOrder] = useState<ReservationOrder | null>(null);
  const [flyerModalOpen, setFlyerModalOpen] = useState(false);

  const scrollToTickets = () => {
    const el = document.getElementById('tickets');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 water-reflection-grid selection:bg-amber-400/30 selection:text-amber-200">
      {/* Navigation Bar */}
      <Navbar onTicketClick={scrollToTickets} />

      {/* Main Single Page Content */}
      <main>
        {/* Hero Section referencing Poster, Host, and 20K/50K Tiers */}
        <Hero
          onGetTicket={scrollToTickets}
          onViewFlyer={() => setFlyerModalOpen(true)}
        />

        {/* Confirmed Lineup & Activities from Poster */}
        <LineupAndVibe />

        {/* Simple & Clear Ticket Purchase (Ordinary 20K / VIP 50K) */}
        <TicketPurchase
          onContinueToPayment={(order) => setActiveOrder(order)}
        />

        {/* Venue Location & RSVP Contact Strip */}
        <VenueAndRsvp />
      </main>

      {/* Clean Minimal Footer */}
      <Footer />

      {/* Demo Checkout Staging Modal */}
      <DemoCheckoutModal
        order={activeOrder}
        onClose={() => setActiveOrder(null)}
      />

      {/* Full Poster Lightbox Modal */}
      <FlyerModal
        isOpen={flyerModalOpen}
        onClose={() => setFlyerModalOpen(false)}
      />
    </div>
  );
}
