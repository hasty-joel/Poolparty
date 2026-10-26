import React from 'react';
import { MapPin, Phone, MessageSquare, ExternalLink, Crown, Clock } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

export const VenueAndRsvp: React.FC = () => {
  return (
    <section id="location" className="py-16 bg-[#070e1b] relative border-t border-amber-500/20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="bg-[#050b14] border border-amber-400/30 rounded-3xl p-6 sm:p-10 shadow-2xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            
            {/* Venue Info (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-amber-300">
                  Event Venue
                </span>
              </div>

              <h2 className="text-3xl sm:text-4xl font-black text-white font-display">
                Prince Resort, Bunamwaya (Bella)
              </h2>

              <p className="text-slate-300 text-sm leading-relaxed max-w-xl">
                Located in Bunamwaya Bella Zone, off the Entebbe Road corridor. Featuring expansive crystal-clear swimming pools, private cabana lounges, and safe on-site parking with full 24/7 guarded security.
              </p>

              <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-300 pt-2">
                <div className="flex items-center gap-1.5 text-white">
                  <MapPin className="w-4 h-4 text-amber-400" />
                  <span>Bunamwaya, Bella Zone, Uganda</span>
                </div>
                <div className="flex items-center gap-1.5 text-white">
                  <Clock className="w-4 h-4 text-cyan-400" />
                  <span>Doors open 12:00 PM till late</span>
                </div>
              </div>

              <div className="pt-2">
                <a
                  href={EVENT_DATA.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-cyan-400/40 hover:border-cyan-300 text-cyan-300 hover:text-white rounded-xl text-xs font-bold tracking-wide transition-all"
                >
                  <MapPin className="w-4 h-4" />
                  <span>OPEN LOCATION IN GOOGLE MAPS</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* RSVP Card (5 cols) */}
            <div className="lg:col-span-5 bg-gradient-to-br from-[#0c1e38] to-[#070e1b] border-2 border-amber-400/50 rounded-2xl p-6 sm:p-8 text-center space-y-4">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-amber-300 block">
                Official RSVP & Table Inquiries
              </span>

              <div className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight">
                {EVENT_DATA.rsvpPhone}
              </div>

              <p className="text-xs text-slate-300">
                Contact event management directly for VIP cabana reservations, group bookings, or media inquiries.
              </p>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <a
                  href={`tel:${EVENT_DATA.rsvpTel}`}
                  className="flex items-center justify-center gap-2 py-3 px-4 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl text-xs font-black uppercase transition-colors"
                >
                  <Phone className="w-4 h-4" />
                  <span>Direct Call</span>
                </a>

                <a
                  href={EVENT_DATA.rsvpWhatsApp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black uppercase transition-colors"
                >
                  <MessageSquare className="w-4 h-4" />
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
