import React from 'react';
import { Headphones, Sparkles, Flame, Utensils, Music, Trophy, Star } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

export const LineupAndVibe: React.FC = () => {
  return (
    <section id="lineup" className="py-16 bg-[#070e1b] relative border-t border-amber-500/15">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-xl mx-auto mb-12">
          <div className="text-xs font-bold tracking-widest text-amber-400 uppercase mb-1">
            Confirmed Artists & Activities
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-white font-display">
            The Official Lineup
          </h2>
          <p className="text-slate-400 text-sm mt-2">
            Non-stop pool entertainment hosted by Trevor DJ with an exclusive Special Surprise Artist.
          </p>
        </div>

        {/* Host & Surprise Artist Marquee */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {/* Host Card */}
          <div className="bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent p-5 rounded-2xl border border-amber-400/40 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-300 block mb-1">
                Official Host
              </span>
              <h3 className="text-2xl font-black text-white font-display">
                Trevor DJ
              </h3>
              <p className="text-xs text-slate-300 mt-1">
                Directing the energy, hype, and poolside vibe from 12 PM till late.
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center shrink-0">
              <Star className="w-6 h-6 text-amber-400" />
            </div>
          </div>

          {/* Surprise Artist Card */}
          <div className="bg-gradient-to-r from-cyan-500/20 via-cyan-500/10 to-transparent p-5 rounded-2xl border border-cyan-400/40 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-cyan-300 block mb-1">
                Headliner Feature
              </span>
              <h3 className="text-2xl font-black text-white font-display">
                Special Surprise Artist
              </h3>
              <p className="text-xs text-slate-300 mt-1">
                To be unveiled on stage at sunset poolside. Exclusive guest performance.
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-cyan-400/20 border border-cyan-400/40 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6 text-cyan-300" />
            </div>
          </div>
        </div>

        {/* DJs & MCs Roster Grid */}
        <div className="mb-12">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-3 text-center sm:text-left">
            DJs & MCs on Deck
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {EVENT_DATA.lineup.map((artist) => (
              <div
                key={artist.name}
                className="bg-[#050b14] border border-white/10 hover:border-amber-400/50 p-4 rounded-xl text-center transition-all group"
              >
                <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-white/5 group-hover:bg-amber-400/20 text-slate-400 group-hover:text-amber-400 flex items-center justify-center transition-colors">
                  <Music className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
                  {artist.role}
                </span>
                <span className="text-sm font-bold text-white block mt-0.5">
                  {artist.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 4 Poster Activities */}
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-3 text-center sm:text-left">
            Party Games & Activities
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            <div className="bg-[#050b14] border border-white/10 p-5 rounded-xl hover:border-cyan-500/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-3">
                <Headphones className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white">Live DJ Music</h4>
              <p className="text-xs text-slate-400 mt-1">
                Back-to-back sets spanning Afrobeats, Amapiano, dancehall, and club anthems.
              </p>
            </div>

            <div className="bg-[#050b14] border border-white/10 p-5 rounded-xl hover:border-amber-500/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-3">
                <Trophy className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white">Swimwear Contest</h4>
              <p className="text-xs text-slate-400 mt-1">
                High-energy poolside contest with prizes for the best beach & swimwear drip.
              </p>
            </div>

            <div className="bg-[#050b14] border border-white/10 p-5 rounded-xl hover:border-pink-500/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-pink-500/10 text-pink-400 flex items-center justify-center mb-3">
                <Flame className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white">Eat My Apple / Truth or Dare</h4>
              <p className="text-xs text-slate-400 mt-1">
                Wild poolside challenges, crowd interactions, and spontaneous social party games.
              </p>
            </div>

            <div className="bg-[#050b14] border border-white/10 p-5 rounded-xl hover:border-orange-500/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-400 flex items-center justify-center mb-3">
                <Utensils className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white">Live Barbeque & Cocktails</h4>
              <p className="text-xs text-slate-400 mt-1">
                Sizzling poolside grill skewers, cold beers, cocktails, and tropical mocktails.
              </p>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
