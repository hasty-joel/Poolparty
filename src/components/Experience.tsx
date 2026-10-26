import React from 'react';
import { Waves, Disc3, Users, Wine, Info, Sparkles } from 'lucide-react';

export const Experience: React.FC = () => {
  return (
    <section id="experience" className="py-24 bg-[#030712] relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold tracking-widest text-cyan-400 uppercase mb-2">
              Curated Event Highlights
            </div>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white font-display [text-wrap:balance]">
              The Poolside Experience
            </h2>
            <p className="mt-4 text-base text-slate-300 leading-relaxed">
              From midday sunshine to an electric night swim under the stars, POOL PARTY delivers an elevated social retreat tailored for good music, great company, and crystal-clear water.
            </p>
          </div>

          {/* Organizer Notice adhering strictly to prompt */}
          <div className="glass-panel-subtle px-4 py-3 rounded-xl border border-white/10 text-xs text-slate-400 max-w-sm flex items-start gap-2.5">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <span>
              Lineup & entertainment are planned experiences. Official resident and guest DJs will be formally announced as bookings are finalized.
            </span>
          </div>
        </div>

        {/* 4 Core Pillars - Asymmetric Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* 1. Poolside Atmosphere (Col span 7) */}
          <div className="md:col-span-7 glass-panel rounded-2xl overflow-hidden border border-white/10 flex flex-col group hover:border-cyan-500/30 transition-all duration-300">
            <div className="relative h-64 sm:h-72 overflow-hidden">
              <img
                src="/src/assets/images/pool_atmosphere_1793036984503.jpg"
                alt="Crystal clear resort pool with teak deck and sun loungers"
                className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0f1e36] via-[#0f1e36]/30 to-transparent" />
              <div className="absolute top-4 left-4 glass-panel-subtle px-3 py-1.5 rounded-lg text-xs font-semibold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                <Waves className="w-3.5 h-3.5 text-cyan-400" />
                <span>Water & Cabanas</span>
              </div>
            </div>
            <div className="p-6 sm:p-8 flex-1 flex flex-col justify-between">
              <div>
                <h3 className="text-2xl font-bold text-white font-display mb-2">
                  01. Poolside Atmosphere & Daybeds
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed mb-4">
                  Surround yourself with crystal clear turquoise waters, wide teak sun decks, shaded cabana options, and plenty of space to swim, float, or lounge in style.
                </p>
              </div>
              <div className="pt-4 border-t border-white/10 flex items-center gap-3 text-xs text-slate-400">
                <span>Heated & filtered waters</span>
                <span aria-hidden="true">·</span>
                <span>Towel service ready</span>
                <span aria-hidden="true">·</span>
                <span>Dedicated lifeguard team</span>
              </div>
            </div>
          </div>

          {/* 2. Music & DJs (Col span 5) */}
          <div className="md:col-span-5 glass-panel rounded-2xl overflow-hidden border border-white/10 flex flex-col group hover:border-cyan-500/30 transition-all duration-300">
            <div className="relative h-64 sm:h-72 overflow-hidden">
              <img
                src="/src/assets/images/poolside_music_1793036985215.jpg"
                alt="DJ booth and ambient poolside party sound system"
                className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0f1e36] via-[#0f1e36]/30 to-transparent" />
              <div className="absolute top-4 left-4 glass-panel-subtle px-3 py-1.5 rounded-lg text-xs font-semibold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                <Disc3 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Live Audio</span>
              </div>
            </div>
            <div className="p-6 sm:p-8 flex-1 flex flex-col justify-between">
              <div>
                <h3 className="text-2xl font-bold text-white font-display mb-2">
                  02. Music & Sunset DJs
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed mb-4">
                  Seamless acoustic sound progression moving from relaxed afternoon Afro-house and soulful beats into high-energy twilight Amapiano and dancehall as dusk falls.
                </p>
              </div>
              <div className="pt-4 border-t border-white/10 flex items-center gap-3 text-xs text-slate-400">
                <span>Guest DJ roster TBA</span>
                <span aria-hidden="true">·</span>
                <span>High-fidelity acoustic rig</span>
              </div>
            </div>
          </div>

          {/* 3. Food, Drinks & Refreshment (Col span 5) */}
          <div className="md:col-span-5 glass-panel rounded-2xl overflow-hidden border border-white/10 flex flex-col group hover:border-cyan-500/30 transition-all duration-300">
            <div className="relative h-64 sm:h-72 overflow-hidden">
              <img
                src="/src/assets/images/pool_refreshments_1793036986532.jpg"
                alt="Artisan cocktail and refreshing tropical beverages"
                className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0f1e36] via-[#0f1e36]/30 to-transparent" />
              <div className="absolute top-4 left-4 glass-panel-subtle px-3 py-1.5 rounded-lg text-xs font-semibold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                <Wine className="w-3.5 h-3.5 text-cyan-400" />
                <span>Bar & Kitchen</span>
              </div>
            </div>
            <div className="p-6 sm:p-8 flex-1 flex flex-col justify-between">
              <div>
                <h3 className="text-2xl font-bold text-white font-display mb-2">
                  03. Cocktails & Grill Bites
                </h3>
                <p className="text-slate-300 text-sm leading-relaxed mb-4">
                  Full resort bar offering signature passionfruit mojitos, chilled craft ciders, fruit mocktails, plus barbecue grilled skewers and poolside comfort cuisine.
                </p>
              </div>
              <div className="pt-4 border-t border-white/10 flex items-center gap-3 text-xs text-slate-400">
                <span>Card & Mobile Money bar</span>
                <span aria-hidden="true">·</span>
                <span>Fresh fruit smoothies</span>
              </div>
            </div>
          </div>

          {/* 4. Friends & Social Experiences (Col span 7) */}
          <div className="md:col-span-7 glass-panel rounded-2xl overflow-hidden border border-white/10 p-6 sm:p-8 flex flex-col justify-between hover:border-cyan-500/30 transition-all duration-300 relative">
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300 uppercase tracking-wider mb-3">
                <Users className="w-4 h-4 text-cyan-400" />
                <span>Vibe & Community</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-white font-display mb-3">
                04. Friends & Social Experiences
              </h3>
              <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-6">
                Pool Party is designed for effortless connection. Bring your crew, reserve a poolside perimeter daybed, partake in casual water games, or simply unwind with old and new friends in an exclusive, high-security environment.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-[#050b14]/70 p-4 rounded-xl border border-white/5">
                  <h4 className="text-white font-semibold text-sm mb-1">Group Cabana Lounging</h4>
                  <p className="text-xs text-slate-400">
                    Spacious covered setups suitable for groups of 4 to 8 with dedicated bottle service attendants.
                  </p>
                </div>
                <div className="bg-[#050b14]/70 p-4 rounded-xl border border-white/5">
                  <h4 className="text-white font-semibold text-sm mb-1">Twilight Illumination</h4>
                  <p className="text-xs text-slate-400">
                    As the sun sets over Bunamwaya, ambient underwater lighting transforms the pool into an electric evening venue.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-6 border-t border-white/10 flex flex-wrap items-center justify-between text-xs text-slate-400 relative z-10 gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>Strict 18+ policy for all attendees</span>
              </div>
              <div>Resort lockers & changing suites available</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
