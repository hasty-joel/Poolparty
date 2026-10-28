import React, { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { PoolPartyLogo } from './brand/PoolPartyLogo';

interface PreloaderProps {
  onComplete: () => void;
  durationMs?: number; // Defaults to 3000ms (3 seconds)
}

export const Preloader: React.FC<PreloaderProps> = ({
  onComplete,
  durationMs = 3000,
}) => {
  const [progress, setProgress] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Setting the poolside atmosphere...');

  useEffect(() => {
    const startTime = Date.now();
    const intervalTime = 30; // 30ms step for fluid 60fps progress

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const currentProgress = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setProgress(currentProgress);

      if (currentProgress < 35) {
        setStatusMessage('Setting the poolside atmosphere...');
      } else if (currentProgress < 75) {
        setStatusMessage('Syncing VIP passes & reservations...');
      } else {
        setStatusMessage('Welcome to Prince Resort Bunamwaya!');
      }

      if (elapsed >= durationMs) {
        clearInterval(interval);
        setIsFadingOut(true);
        setTimeout(() => {
          onComplete();
        }, 350);
      }
    }, intervalTime);

    return () => clearInterval(interval);
  }, [durationMs, onComplete]);

  const handleSkip = () => {
    setIsFadingOut(true);
    setTimeout(() => {
      onComplete();
    }, 150);
  };

  return (
    <aside
      aria-label="Site Preloader"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-sky-50 via-white to-cyan-50 text-slate-900 transition-opacity duration-300 ease-out select-none ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      role="status"
      aria-live="polite"
    >
      {/* Light tropical ambient background illumination & subtle ripple */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] sm:w-[540px] h-[380px] sm:h-[540px] bg-cyan-200/40 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[240px] sm:w-[360px] h-[240px] sm:h-[360px] bg-amber-200/50 rounded-full blur-[80px]" />
      </div>

      {/* Main Light Content Box */}
      <div className="relative z-10 flex flex-col items-center px-6 max-w-sm w-full text-center">
        {/* Animated Brand Emblem on Light Background */}
        <div className="relative mb-5">
          <div className="absolute -inset-3 bg-gradient-to-r from-cyan-400/20 to-amber-400/20 rounded-2xl blur-md opacity-80 animate-pulse" />
          <PoolPartyLogo variant="icon" size="xl" />
        </div>

        {/* Brand Titles */}
        <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.25em] text-cyan-700 font-bold mb-1">
          Prince Resort Bunamwaya · Bella
        </span>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-950 font-display mb-1.5">
          POOL <span className="text-amber-500">PARTY</span>
        </h1>
        <p className="text-xs text-slate-600 mb-6 flex items-center justify-center gap-1.5 font-medium">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Friday, 11 December 2026 · From 12:00 PM</span>
        </p>

        {/* 3-Second Light Progress Bar Container */}
        <div className="w-full max-w-xs space-y-2">
          <div className="h-2 w-full bg-slate-200/90 rounded-full overflow-hidden border border-slate-300/60 p-[1px] shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-teal-400 to-amber-500 rounded-full transition-all duration-75 ease-linear shadow-[0_0_8px_rgba(6,182,212,0.4)]"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 px-0.5">
            <span className="truncate max-w-[210px] text-left font-medium">{statusMessage}</span>
            <span className="font-mono text-cyan-700 font-bold tabular-nums shrink-0">
              {progress}%
            </span>
          </div>
        </div>

        {/* Subtle Light Skip Button */}
        <button
          onClick={handleSkip}
          className="mt-7 text-[11px] text-slate-500 hover:text-slate-800 uppercase tracking-wider font-semibold transition-colors cursor-pointer px-3.5 py-1 rounded-full bg-white/80 hover:bg-white border border-slate-200 shadow-xs"
          type="button"
        >
          Skip Intro
        </button>
      </div>
    </aside>
  );
};
