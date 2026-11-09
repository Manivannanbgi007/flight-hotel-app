import { useId } from 'react';

import { cn } from '@/lib/cn';

/**
 * The assistant's face: a small illustrated robot with a headset, a glowing visor, blinking eyes, a smile, a pulsing
 * antenna and twinkling sparkles. It is a vector drawing (SVG, no image file), so it stays sharp at any size and takes
 * the portal's accent from the button it sits on. The animation is plain CSS (`mascot-*` in index.css): it bobs, blinks
 * and twinkles all the time, and looks around while the assistant is working (`busy`). Under reduced motion it stands
 * still (the global rule). It is decoration: the button around it carries the accessible name.
 */
export function AssistantMascot({ className, busy = false }: { className?: string; busy?: boolean }) {
  const base = `mascot${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const head = `${base}-head`;
  const visor = `${base}-visor`;
  const glow = `${base}-glow`;
  const pod = `${base}-pod`;
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={cn('mascot overflow-visible', busy && 'mascot--busy', className)}>
      <defs>
        <linearGradient id={head} x1="12" y1="10" x2="52" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dbe6ff" />
        </linearGradient>
        <linearGradient id={visor} x1="14" y1="20" x2="50" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#25357f" />
          <stop offset="1" stopColor="#0f1b4d" />
        </linearGradient>
        <linearGradient id={pod} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd166" />
          <stop offset="1" stopColor="#ff9f43" />
        </linearGradient>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Sparkles around the head */}
      <path className="mascot-twinkle" d="M56 6 l1.6 4.2 4.2 1.6 -4.2 1.6 -1.6 4.2 -1.6 -4.2 -4.2 -1.6 4.2 -1.6z" fill="#ffd166" />
      <path className="mascot-twinkle mascot-twinkle--late" d="M7 14 l1.1 2.9 2.9 1.1 -2.9 1.1 -1.1 2.9 -1.1 -2.9 -2.9 -1.1 2.9 -1.1z" fill="#8ff0ff" />

      <g className="mascot-bob">
        {/* Antenna */}
        <path d="M32 11 V5.5" stroke="#c7d6ff" strokeWidth="2.2" strokeLinecap="round" />
        <circle className="mascot-antenna-glow" cx="32" cy="4.6" r="4" fill="#ffd166" opacity="0.45" />
        <circle cx="32" cy="4.6" r="2.6" fill="#ffd166" stroke="#fff" strokeWidth="1" />

        {/* Headset: ear pods and the band */}
        <path d="M8.5 30 C8.5 17 18 9.5 32 9.5 S55.5 17 55.5 30" fill="none" stroke="#c7d6ff" strokeWidth="2" strokeLinecap="round" />
        <rect x="3.5" y="26" width="7" height="15" rx="3.5" fill={`url(#${pod})`} stroke="#fff" strokeWidth="1" />
        <rect x="53.5" y="26" width="7" height="15" rx="3.5" fill={`url(#${pod})`} stroke="#fff" strokeWidth="1" />

        {/* Head */}
        <rect x="9" y="12" width="46" height="40" rx="17" fill={`url(#${head})`} stroke="#fff" strokeWidth="1.4" />
        <path d="M17 17 C22 13.5 30 13 36 14" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />

        {/* Visor with eyes and smile */}
        <rect x="14" y="20" width="36" height="24" rx="12" fill={`url(#${visor})`} />
        <g filter={`url(#${glow})`}>
          <g className="mascot-look">
            <ellipse className="mascot-eye" cx="24.5" cy="30.5" rx="3.3" ry="4.4" fill="#7df9ff" />
            <ellipse className="mascot-eye mascot-eye--late" cx="39.5" cy="30.5" rx="3.3" ry="4.4" fill="#7df9ff" />
          </g>
          <path d="M26.5 38.2 Q32 42.4 37.5 38.2" fill="none" stroke="#7df9ff" strokeWidth="1.9" strokeLinecap="round" />
        </g>
        <circle cx="17.5" cy="37.5" r="2" fill="#ff8fab" opacity="0.55" />
        <circle cx="46.5" cy="37.5" r="2" fill="#ff8fab" opacity="0.55" />

        {/* Shoulders */}
        <path d="M20 52.5 C20 58 25 60.5 32 60.5 S44 58 44 52.5" fill="#c7d6ff" stroke="#fff" strokeWidth="1.2" />
      </g>
    </svg>
  );
}
