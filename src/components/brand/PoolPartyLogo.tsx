import React from 'react';

interface PoolPartyLogoProps {
  variant?: 'full' | 'icon' | 'badge';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showSubtitle?: boolean;
}

export const PoolPartyLogo: React.FC<PoolPartyLogoProps> = ({
  variant = 'full',
  size = 'md',
  className = '',
  showSubtitle = true,
}) => {
  // Dimension tokens
  const iconDimensions = {
    sm: 'w-7 h-7',
    md: 'w-9 h-9',
    lg: 'w-12 h-12',
    xl: 'w-20 h-20',
  }[size];

  const titleSizes = {
    sm: 'text-sm',
    md: 'text-base sm:text-lg',
    lg: 'text-xl sm:text-2xl',
    xl: 'text-3xl sm:text-4xl',
  }[size];

  const subtitleSizes = {
    sm: 'text-[8px]',
    md: 'text-[9.5px] sm:text-[10px]',
    lg: 'text-xs',
    xl: 'text-sm',
  }[size];

  // SVG Icon Emblem
  const IconEmblem = (
    <div
      className={`relative ${iconDimensions} shrink-0 rounded-xl bg-gradient-to-br from-[#0e2238] via-[#07111f] to-[#040812] border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.18)] flex items-center justify-center overflow-hidden p-1 transition-transform group-hover:scale-105`}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="logoSunGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="50%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
          <linearGradient id="logoWaveGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="60%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#0891b2" />
          </linearGradient>
        </defs>

        {/* Ambient glow behind sun */}
        <circle cx="50" cy="38" r="24" fill="#fbbf24" opacity="0.18" />

        {/* Golden Sun & Rays */}
        <circle cx="50" cy="36" r="13" fill="url(#logoSunGrad)" />
        <path
          d="M 50 14 L 50 19 M 32 20 L 36 24 M 68 20 L 64 24 M 26 36 L 31 36 M 74 36 L 69 36"
          stroke="url(#logoSunGrad)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Cyan Wave Crests */}
        <path
          d="M 12 58 C 24 50, 36 64, 50 56 C 64 48, 76 62, 88 54 L 88 64 C 76 72, 64 58, 50 66 C 36 74, 24 60, 12 68 Z"
          fill="url(#logoWaveGrad)"
        />
        <path
          d="M 12 72 C 24 65, 36 77, 50 70 C 64 63, 76 75, 88 68 L 88 77 C 76 84, 64 72, 50 79 C 36 86, 24 74, 12 81 Z"
          fill="url(#logoWaveGrad)"
          opacity="0.8"
        />
      </svg>
    </div>
  );

  if (variant === 'icon') {
    return <div className={`inline-flex items-center ${className}`}>{IconEmblem}</div>;
  }

  return (
    <div className={`inline-flex items-center gap-2 sm:gap-3 ${className}`}>
      {IconEmblem}
      <div className="flex flex-col min-w-0">
        {showSubtitle && (
          <span
            className={`${subtitleSizes} uppercase tracking-wider sm:tracking-widest text-slate-400 font-semibold leading-none truncate`}
          >
            Prince Resort Bunamwaya
          </span>
        )}
        <span
          className={`${titleSizes} font-black tracking-tight text-white font-display leading-tight transition-colors truncate`}
        >
          POOL <span className="text-amber-400">PARTY</span>
        </span>
      </div>
    </div>
  );
};
