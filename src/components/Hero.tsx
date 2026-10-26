import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Crown, MapPin, Sparkles, Ticket, Phone, Flame, Eye } from 'lucide-react';
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
    <section className="relative min-h-[90vh] pt-24 pb-16 flex items-center justify-center overflow-hidden">
      {/* Background with dark water texture & tropical leaves */}
      <div className="absolute inset-0 z-0">
        <img
          src="/src/assets/images/hero_pool_luxury_1793036984424.jpg"
          alt="Luxury Pool Party Background"
          className="w-full h-full object-cover object-center scale-105"
          referrerPolicy="no-referrer"
        />
        {/* Contrast scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#030712] via-[#030712]/85 to-[#030712]/60" />
        <div className="absolute inset-0 bg-radial-gradient from-transparent via-[#030712]/50 to-[#030712]/90" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Left Column: Event details, bold typography, pricing */}
          <div className="lg:col-span-7 text-center lg:text-left flex flex-col items-center lg:items-start">
            
            {/* Crown & Prince Resort Bunamwaya Bella */}
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-5 h-5 text-amber-400" />
              <span className="text-xs sm:text-sm font-extrabold uppercase tracking-widest text-slate-200">
                Prince Resort
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-black text-amber-400 italic tracking-wide mb-3 drop-shadow-sm font-display">
              Bunamwaya Bella
            </div>

            {/* Title: POOL PARTY matching poster */}
            <h1 className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tight leading-none mb-3">
              <span className="text-transparent bg-clip-text bg-gradient-to-b from-cyan-200 via-sky-400 to-blue-600 drop-shadow-[0_4px_12px_rgba(6,182,212,0.4)]">
                POOL
              </span>{' '}
              <span className="text-white italic tracking-wider font-display drop-shadow-[0_3px_8px_rgba(0,0,0,0.8)]">
                PARTY
              </span>
            </h1>

            {/* Hosted by Trevor DJ Banner */}
            <div className="inline-block bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 font-black text-sm sm:text-base px-5 py-2 rounded-lg transform -rotate-1 shadow-md mb-4 font-display uppercase tracking-wide">
              Hosted by Trevor DJ
            </div>

            {/* Special Surprise Artist Tag */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-400/80 bg-amber-950/40 text-amber-300 text-xs sm:text-sm font-bold tracking-wide mb-5">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Special Surprise Artist</span>
              <Sparkles className="w-4 h-4 text-amber-400" />
            </div>

            {/* Date & Time */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-y-2 gap-x-4 text-sm sm:text-base text-slate-200 font-semibold mb-6">
              <span className="flex items-center gap-1.5 text-amber-300">
                <Calendar className="w-4 h-4 text-amber-400" />
                Friday, December 11th 2026
              </span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="flex items-center gap-1.5 text-white">
                <Clock className="w-4 h-4 text-cyan-400" />
                12 PM – till late
              </span>
            </div>

            {/* Poster Activities Quick Strip */}
            <div className="grid grid-cols-3 gap-2 w-full max-w-md mb-8 text-center">
              <div className="bg-[#050b14]/80 border border-white/10 rounded-xl p-2.5">
                <span className="block text-xs font-bold text-white">Live DJ Music</span>
                <span className="text-[10px] text-slate-400">Non-stop grooves</span>
              </div>
              <div className="bg-[#050b14]/80 border border-white/10 rounded-xl p-2.5">
                <span className="block text-xs font-bold text-amber-300">Swimwear Contest</span>
                <span className="text-[10px] text-slate-400">Poolside runway</span>
              </div>
              <div className="bg-[#050b14]/80 border border-white/10 rounded-xl p-2.5">
                <span className="block text-xs font-bold text-cyan-300">Live Barbeque</span>
                <span className="text-[10px] text-slate-400">& Party Games</span>
              </div>
            </div>

            {/* Direct Ticket Tier Banner: Ordinary: 20K | VIP: 50K */}
            <div className="w-full max-w-md p-4 rounded-2xl border-2 border-amber-400/90 bg-[#070e1b]/95 shadow-xl shadow-amber-500/10 mb-6">
              <div className="flex items-center justify-around divide-x divide-white/10">
                <div className="px-3 text-center">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 block font-semibold">
                    Ordinary Pass
                  </span>
                  <span className="text-2xl font-black text-amber-300 font-mono tabular-nums">
                    UGX 20,000
                  </span>
                </div>
                <div className="px-3 text-center">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 block font-semibold">
                    VIP Pass
                  </span>
                  <span className="text-2xl font-black text-cyan-300 font-mono tabular-nums">
                    UGX 50,000
                  </span>
                </div>
              </div>
            </div>

            {/* Primary Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
              <button
                onClick={onGetTicket}
                className="w-full sm:w-auto px-8 py-4 text-sm font-black tracking-wider text-slate-950 bg-gradient-to-r from-amber-400 via-amber-300 to-cyan-400 hover:from-amber-300 hover:to-cyan-300 transition-all rounded-xl shadow-lg shadow-amber-500/20 active:scale-98 whitespace-nowrap cursor-pointer uppercase flex items-center justify-center gap-2"
              >
                <Ticket className="w-4 h-4" />
                <span>BOOK TICKETS (20K / 50K)</span>
              </button>

              <button
                onClick={onViewFlyer}
                className="w-full sm:w-auto px-6 py-4 text-xs font-bold tracking-wider text-slate-200 hover:text-white bg-white/5 hover:bg-white/10 border border-white/15 rounded-xl transition-colors cursor-pointer uppercase flex items-center justify-center gap-2"
              >
                <Eye className="w-4 h-4 text-cyan-400" />
                <span>VIEW OFFICIAL FLYER</span>
              </button>
            </div>
          </div>

          {/* Right Column: Visual Poster Card & Countdown */}
          <div className="lg:col-span-5 flex flex-col items-center">
            {/* Clickable Flyer Showcase */}
            <div 
              onClick={onViewFlyer}
              className="relative rounded-2xl overflow-hidden border-2 border-amber-400/50 shadow-2xl shadow-cyan-500/20 cursor-pointer group max-w-sm transition-all duration-300 hover:scale-[1.02] hover:border-cyan-400"
            >
              <img
                src={EVENT_DATA.flyerImage}
                alt="Official Luxury Tropical Pool Party Flyer"
                className="w-full h-auto object-cover"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-xs">
                <span className="px-4 py-2 bg-slate-900/90 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 border border-white/20">
                  <Eye className="w-4 h-4 text-amber-400" />
                  <span>Click to Expand Poster</span>
                </span>
              </div>
            </div>

            {/* Countdown Strip */}
            <div className="w-full max-w-sm mt-4 bg-[#070e1b]/90 border border-white/10 rounded-xl p-3 text-center">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-2">
                Gates open 12:00 PM · Dec 11, 2026
              </span>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-[#030712] rounded-lg p-1.5">
                  <span className="block text-lg font-bold text-white font-mono">{timeLeft.days}</span>
                  <span className="text-[9px] text-slate-400 uppercase">Days</span>
                </div>
                <div className="bg-[#030712] rounded-lg p-1.5">
                  <span className="block text-lg font-bold text-amber-300 font-mono">{timeLeft.hours}</span>
                  <span className="text-[9px] text-slate-400 uppercase">Hours</span>
                </div>
                <div className="bg-[#030712] rounded-lg p-1.5">
                  <span className="block text-lg font-bold text-white font-mono">{timeLeft.minutes}</span>
                  <span className="text-[9px] text-slate-400 uppercase">Mins</span>
                </div>
                <div className="bg-[#030712] rounded-lg p-1.5">
                  <span className="block text-lg font-bold text-cyan-300 font-mono">{timeLeft.seconds}</span>
                  <span className="text-[9px] text-slate-400 uppercase">Secs</span>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>
    </section>
  );
};
