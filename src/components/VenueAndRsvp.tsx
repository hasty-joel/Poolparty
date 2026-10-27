import React from 'react';
import { MapPin, Phone, MessageSquare, ExternalLink, Clock } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

export const VenueAndRsvp: React.FC = () => {
  return (
    <section id="location" className="py-12 sm:py-20 bg-[#080c14] relative border-b border-white/10">
      <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8">
        
        <div className="bg-[#0d1522] border border-white/10 rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-10 shadow-lg">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-center">
            
            {/* Venue Info (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block mb-1">
                  Venue & Location
                </span>
                <h2 className="text-xl sm:text-3xl font-black text-white font-display">
                  Prince Resort, Bunamwaya (Bella)
                </h2>
              </div>

              <p className="text-slate-300 text-xs sm:text-sm leading-relaxed max-w-xl">
                Located in Bunamwaya Bella Zone, off the Entebbe Road corridor. Featuring expansive swimming pools, private cabana lounges, pool decks, and on-site parking with 24/7 guarded security.
              </p>

              <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs font-medium text-slate-300 pt-1">
                <div className="flex items-center gap-1.5 text-slate-200">
                  <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Bunamwaya - Bella Zone, Uganda</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-200">
                  <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Gates open 12:00 PM Till Late</span>
                </div>
              </div>

              <div className="pt-2">
                <a
                  href={EVENT_DATA.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 min-h-[44px] bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-bold tracking-wide transition-colors"
                >
                  <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Open in Google Maps</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </a>
              </div>
            </div>

            {/* RSVP Card (5 cols) */}
            <div className="lg:col-span-5 bg-[#080c14] border border-white/10 rounded-xl p-4 sm:p-6 text-center space-y-3">
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-amber-400 block">
                Direct RSVP & Table Inquiries
              </span>

              <div className="text-xl sm:text-2xl font-black text-white font-mono tracking-tight tabular-nums break-all sm:break-normal">
                {EVENT_DATA.rsvpPhone}
              </div>

              <p className="text-xs text-slate-400">
                Contact event management for VIP cabana bookings, bottle service, or group table reservations.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 pt-2">
                <a
                  href={`tel:${EVENT_DATA.rsvpTel}`}
                  className="flex items-center justify-center gap-2 py-3 px-3 min-h-[44px] bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg text-xs font-bold uppercase transition-colors"
                >
                  <Phone className="w-3.5 h-3.5 shrink-0" />
                  <span>Direct Call</span>
                </a>

                <a
                  href={EVENT_DATA.rsvpWhatsApp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-3 px-3 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold uppercase transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span>WhatsApp</span>
                </a>
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
