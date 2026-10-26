import React from 'react';
import { Calendar, Clock, MapPin, ExternalLink, ShieldCheck, Car, Navigation, Compass, Sparkles } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

export const EventDetails: React.FC = () => {
  return (
    <section id="venue" className="py-20 bg-[#070e1b] relative border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-3xl mb-12">
          <div className="text-xs font-semibold tracking-widest text-cyan-400 uppercase mb-2">
            Location & Event Schedule
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white font-display [text-wrap:balance]">
            Prince Resort, Bunamwaya (Bella)
          </h2>
          <p className="mt-3 text-base text-slate-300 leading-relaxed">
            Nestled in the lush hills of Bunamwaya, Prince Resort provides an expansive poolside oasis with sweeping views, palm-fringed lounge decks, and premier resort amenities designed for an unforgettable day and night.
          </p>
        </div>

        {/* 4-Item Quick Facts Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          <div className="glass-panel-subtle p-5 rounded-xl border border-white/10 hover:border-cyan-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-2 text-cyan-400">
              <Calendar className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Date</span>
            </div>
            <div className="text-lg font-bold text-white">Friday, 11 Dec 2026</div>
            <div className="text-xs text-slate-400 mt-1">Exclusive one-day event</div>
          </div>

          <div className="glass-panel-subtle p-5 rounded-xl border border-white/10 hover:border-cyan-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-2 text-cyan-400">
              <Clock className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Hours</span>
            </div>
            <div className="text-lg font-bold text-white">12:00 PM – 2:00 AM</div>
            <div className="text-xs text-slate-400 mt-1">Daytime swim into night party</div>
          </div>

          <div className="glass-panel-subtle p-5 rounded-xl border border-white/10 hover:border-cyan-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-2 text-cyan-400">
              <MapPin className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Venue</span>
            </div>
            <div className="text-lg font-bold text-white">Prince Resort</div>
            <div className="text-xs text-slate-400 mt-1">Bunamwaya (Bella), Uganda</div>
          </div>

          <div className="glass-panel-subtle p-5 rounded-xl border border-white/10 hover:border-cyan-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-2 text-cyan-400">
              <ShieldCheck className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Admission</span>
            </div>
            <div className="text-lg font-bold text-cyan-300 font-mono tabular-nums">UGX 19,997</div>
            <div className="text-xs text-slate-400 mt-1">Single pass with QR scan</div>
          </div>
        </div>

        {/* Venue Image + Verified Google Maps Information */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Venue Photography Card */}
          <div className="lg:col-span-7 rounded-2xl overflow-hidden glass-panel-subtle border border-white/10 relative min-h-[340px] flex flex-col justify-end">
            <img
              src="/src/assets/images/resort_venue_prince_1793036985739.jpg"
              alt="Prince Resort Bunamwaya Poolside grounds and gardens"
              className="absolute inset-0 w-full h-full object-cover object-center"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#030712] via-[#030712]/50 to-transparent" />
            <div className="relative z-10 p-6 sm:p-8">
              <div className="text-xs font-semibold tracking-wider text-cyan-300 uppercase mb-1">
                The Grounds
              </div>
              <h3 className="text-2xl font-bold text-white font-display">
                Prince Resort Grounds & Pool Deck
              </h3>
              <p className="text-sm text-slate-200 mt-2 max-w-xl">
                Features crystal deep waters, surrounding sun deck loungers, private VIP cabanas, dedicated changing facilities, and 360-degree resort hospitality.
              </p>
            </div>
          </div>

          {/* Location & Navigation Card */}
          <div className="lg:col-span-5 glass-panel p-6 sm:p-8 rounded-2xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">
                  Getting Here
                </span>
                <span className="text-xs text-slate-400">Bunamwaya, Bella Zone</span>
              </div>

              <h3 className="text-xl font-bold text-white font-display mb-4">
                Directions & Venue Access
              </h3>

              <div className="space-y-4 text-sm text-slate-300">
                <div className="flex items-start gap-3">
                  <Navigation className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-white">From Kampala Central</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Approx. 20–30 mins via Entebbe Road or the Northern Bypass connecting towards Bunamwaya-Bella.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Car className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-white">Parking & Drop-offs</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Dedicated on-site secure parking with 24/7 guarded security personnel and easy rideshare pickup zone.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Compass className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-white">Resort Entrance</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Main resort gate check-in point. Digital ticket scanners active starting 12:00 PM prompt.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Verified Google Maps Action Button */}
            <div className="mt-8 pt-6 border-t border-white/10">
              <a
                href={EVENT_DATA.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-4 bg-slate-900/90 hover:bg-slate-800 border border-cyan-500/30 hover:border-cyan-400 text-cyan-300 hover:text-white rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-sm font-semibold tracking-wide cursor-pointer group"
              >
                <span>OPEN IN GOOGLE MAPS</span>
                <ExternalLink className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </a>
              <p className="text-center text-[11px] text-slate-400 mt-2">
                Prince Resort, Bunamwaya (Bella), Uganda · Tap to open navigation
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
