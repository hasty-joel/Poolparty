import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, Ticket, Eye, Music } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

interface HeroProps {
  onGetTicket: () => void;
  onViewFlyer: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onGetTicket, onViewFlyer }) => {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const targetDate = new Date('2026-12-11T12:00:00+03:00').getTime();

    const updateTimer = () => {
      const now = new Date().getTime();
      const diff = targetDate - now;

      if (diff > 0) {
        setTimeLeft({
          days: Math.floor(diff / (1000 * 60 * 60 * 24)),
          hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((diff / 1000 / 60) % 60),
          seconds: Math.floor((diff / 1000) % 60),
        });
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-[85vh] pt-28 pb-16 flex items-center justify-center overflow-hidden border-b border-white/10">
      {/* Background imagery with subtle natural dark scrim */}
      <div className="absolute inset-0 z-0">
        <img
          src="/src/assets/images/hero_pool_luxury_1793036984424.jpg"
          alt="Prince Resort Poolside"
          className="w-full h-full object-cover object-center"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-[#080c14]/90" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          
          {/* Left Column: Event details, bold typography, pricing */}
          <div className="lg:col-span-7 flex flex-col items-center lg:items-start text-center lg:text-left space-y-6">
            
            {/* Editorial metadata kicker */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2 text-xs font-semibold text-slate-400">
              <span className="text-amber-400">Prince Resort Bunamwaya</span>
              <span aria-hidden="true">·</span>
              <span>Friday, 11 December 2026</span>
              <span aria-hidden="true">·</span>
              <span>From 12:00 PM Till Late</span>
            </div>

            {/* Event Title */}
            <div>
              <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white font-display leading-[1.05]">
                POOL PARTY <span className="text-amber-400">2026</span>
              </h1>
              <p className="text-slate-300 text-base sm:text-lg mt-3 max-w-xl font-normal leading-relaxed">
                Experience Uganda's premier poolside celebration hosted by <strong className="text-white font-semibold">Trevor DJ</strong> with a <strong className="text-amber-300 font-semibold">Special Surprise Headliner</strong> at Prince Resort, Bunamwaya Bella.
              </p>
            </div>

            {/* Direct Ticket Tier Strip: Ordinary 20K | VIP 50K */}
            <div className="w-full max-w-md p-4 rounded-xl bg-[#0d1522] border border-white/10">
              <div className="grid grid-cols-2 divide-x divide-white/10 text-center">
                <div className="px-3">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 block font-medium">
                    Ordinary Pass
                  </span>
                  <span className="text-2xl font-black text-white font-mono tabular-nums">
                    UGX 20,000
                  </span>
                </div>
                <div className="px-3">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 block font-medium">
                    VIP Pass
                  </span>
                  <span className="text-2xl font-black text-amber-300 font-mono tabular-nums">
                    UGX 50,000
                  </span>
                </div>
              </div>
            </div>

            {/* Confirmed Activities Summary */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-4 gap-y-2 text-xs text-slate-400">
              <span className="flex items-center gap-1.5 text-slate-300">
                <Music className="w-3.5 h-3.5 text-amber-400" />
                Live DJ Music
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300">Swimwear Contest</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300">Eat My Apple & Truth or Dare</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300">Live Poolside Barbeque</span>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto pt-2">
              <button
                onClick={onGetTicket}
                className="w-full sm:w-auto px-7 py-3.5 text-xs font-bold tracking-wider text-slate-950 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 transition-colors rounded-lg shadow-sm whitespace-nowrap cursor-pointer uppercase flex items-center justify-center gap-2 font-display"
              >
                <Ticket className="w-4 h-4" />
                <span>Book Tickets (20K / 50K)</span>
              </button>

              <button
                onClick={onViewFlyer}
                className="w-full sm:w-auto px-6 py-3.5 text-xs font-semibold tracking-wider text-slate-200 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors cursor-pointer uppercase flex items-center justify-center gap-2"
              >
                <Eye className="w-4 h-4 text-slate-400" />
                <span>View Official Flyer</span>
              </button>
            </div>
          </div>

          {/* Right Column: Official Poster Card & Countdown */}
          <div className="lg:col-span-5 flex flex-col items-center">
            {/* Clickable Flyer Showcase */}
            <div 
              onClick={onViewFlyer}
              className="relative rounded-xl overflow-hidden border border-white/15 bg-[#0d1522] shadow-xl cursor-pointer group max-w-sm transition-transform duration-200 hover:scale-[1.01]"
            >
              <img
                src={EVENT_DATA.flyerImage}
                alt="Official Luxury Tropical Pool Party Flyer"
                className="w-full h-auto object-cover"
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="px-4 py-2 bg-slate-950 text-white rounded-lg text-xs font-semibold flex items-center gap-2 border border-white/20">
                  <Eye className="w-4 h-4 text-amber-400" />
                  <span>Click to Expand Poster</span>
                </span>
              </div>
            </div>

            {/* Countdown Strip */}
            <div className="w-full max-w-sm mt-4 bg-[#0d1522] border border-white/10 rounded-xl p-3.5 text-center">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-2.5">
                Countdown to Event Kickoff · Dec 11, 2026
              </span>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-[#080c14] border border-white/5 rounded-lg py-2">
                  <span className="block text-xl font-bold text-white font-mono tabular-nums">{timeLeft.days}</span>
                  <span className="text-[9px] text-slate-400 uppercase font-medium">Days</span>
                </div>
                <div className="bg-[#080c14] border border-white/5 rounded-lg py-2">
                  <span className="block text-xl font-bold text-amber-300 font-mono tabular-nums">{timeLeft.hours}</span>
                  <span className="text-[9px] text-slate-400 uppercase font-medium">Hours</span>
                </div>
                <div className="bg-[#080c14] border border-white/5 rounded-lg py-2">
                  <span className="block text-xl font-bold text-white font-mono tabular-nums">{timeLeft.minutes}</span>
                  <span className="text-[9px] text-slate-400 uppercase font-medium">Mins</span>
                </div>
                <div className="bg-[#080c14] border border-white/5 rounded-lg py-2">
                  <span className="block text-xl font-bold text-cyan-300 font-mono tabular-nums">{timeLeft.seconds}</span>
                  <span className="text-[9px] text-slate-400 uppercase font-medium">Secs</span>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>
    </section>
  );
};
