import React from 'react';
import { Headphones, Music, Trophy, Utensils, Flame, Sparkles } from 'lucide-react';
import { EVENT_DATA } from '../types/event';

export const LineupAndVibe: React.FC = () => {
  return (
    <section id="lineup" className="py-20 bg-[#080c14] relative border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="max-w-2xl mb-12">
          <span className="text-xs font-bold tracking-widest text-amber-400 uppercase block mb-1">
            Confirmed Artists & Activities
          </span>
          <h2 className="text-3xl sm:text-4xl font-black text-white font-display">
            The Official Event Lineup
          </h2>
          <p className="text-slate-400 text-sm mt-2">
            Poolside entertainment and music curation hosted by Trevor DJ with an exclusive Special Surprise Headliner.
          </p>
        </div>

        {/* Host & Headliner Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
          
          {/* Host Card */}
          <div className="bg-[#0d1522] p-6 rounded-xl border border-white/10 flex flex-col justify-between space-y-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block mb-1">
                Official Event Host
              </span>
              <h3 className="text-2xl font-black text-white font-display">
                Trevor DJ
              </h3>
              <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                Directing the poolside energy, hyping the crowd, and orchestrating transitions from afternoon kick-off till late night.
              </p>
            </div>
            <div className="text-[11px] text-slate-400 pt-3 border-t border-white/10 flex items-center justify-between">
              <span>Poolside Stage Host</span>
              <span className="text-amber-300 font-semibold">12:00 PM – Late</span>
            </div>
          </div>

          {/* Surprise Headliner Card */}
          <div className="bg-[#0d1522] p-6 rounded-xl border border-white/10 flex flex-col justify-between space-y-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 block mb-1">
                Guest Feature
              </span>
              <h3 className="text-2xl font-black text-white font-display">
                Special Surprise Artist
              </h3>
              <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                An exclusive headline artist to be revealed live poolside at sunset. Prepared specially for Pool Party 2026.
              </p>
            </div>
            <div className="text-[11px] text-slate-400 pt-3 border-t border-white/10 flex items-center justify-between">
              <span>Sunset Performance</span>
              <span className="text-cyan-300 font-semibold">Exclusive Live Set</span>
            </div>
          </div>

        </div>

        {/* Confirmed DJs & MCs Roster */}
        <div className="mb-14">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              DJs & MCs on Deck
            </h4>
            <span className="text-xs text-slate-500">6 Confirmed Sets</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {EVENT_DATA.lineup.map((artist) => (
              <div
                key={artist.name}
                className="bg-[#0d1522] border border-white/10 p-4 rounded-xl text-center hover:border-slate-600 transition-colors"
              >
                <div className="w-8 h-8 mx-auto mb-2.5 rounded-lg bg-white/5 text-slate-400 flex items-center justify-center">
                  <Music className="w-4 h-4 text-amber-400" />
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 block">
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
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-4">
            Activities & Experiences
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            <div className="bg-[#0d1522] border border-white/10 p-5 rounded-xl space-y-2">
              <div className="w-9 h-9 rounded-lg bg-cyan-950/60 text-cyan-400 flex items-center justify-center mb-1">
                <Headphones className="w-4 h-4" />
              </div>
              <h5 className="text-sm font-bold text-white">Live DJ Music</h5>
              <p className="text-xs text-slate-400 leading-relaxed">
                Non-stop sets spanning Afrobeats, Amapiano, dancehall, and club favorites.
              </p>
            </div>

            <div className="bg-[#0d1522] border border-white/10 p-5 rounded-xl space-y-2">
              <div className="w-9 h-9 rounded-lg bg-amber-950/60 text-amber-400 flex items-center justify-center mb-1">
                <Trophy className="w-4 h-4" />
              </div>
              <h5 className="text-sm font-bold text-white">Swimwear Contest</h5>
              <p className="text-xs text-slate-400 leading-relaxed">
                Poolside runway showcase with prizes awarded for best summer styling.
              </p>
            </div>

            <div className="bg-[#0d1522] border border-white/10 p-5 rounded-xl space-y-2">
              <div className="w-9 h-9 rounded-lg bg-rose-950/60 text-rose-400 flex items-center justify-center mb-1">
                <Flame className="w-4 h-4" />
              </div>
              <h5 className="text-sm font-bold text-white">Social Party Games</h5>
              <p className="text-xs text-slate-400 leading-relaxed">
                Crowd challenges including Eat My Apple, Truth or Dare, and group poolside games.
              </p>
            </div>

            <div className="bg-[#0d1522] border border-white/10 p-5 rounded-xl space-y-2">
              <div className="w-9 h-9 rounded-lg bg-emerald-950/60 text-emerald-400 flex items-center justify-center mb-1">
                <Utensils className="w-4 h-4" />
              </div>
              <h5 className="text-sm font-bold text-white">Barbeque & Drinks</h5>
              <p className="text-xs text-slate-400 leading-relaxed">
                Live grill skewers, craft cocktails, beers, and tropical non-alcoholic refreshments.
              </p>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
