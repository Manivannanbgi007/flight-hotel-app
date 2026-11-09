import { P } from './palette';
import { Cloud, Palm, Pin, Plane, Sparkle, Svg, type IllustrationProps } from './shapes';
import { useSvgIds } from './useSvgIds';

/** Hero scene: a plane climbing over a sunset sea, clouds drifting. 480 × 320. */
export function TravelHeroIllustration({ className }: IllustrationProps) {
  const id = useSvgIds('sky', 'sun', 'sea', 'clip');
  return (
    <Svg viewBox="0 0 480 320" className={className}>
      <defs>
        <linearGradient id={id.sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.brand200} />
          <stop offset="0.55" stopColor={P.brand50} />
          <stop offset="1" stopColor={P.accent100} />
        </linearGradient>
        <radialGradient id={id.sun} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={P.accent200} stopOpacity="0.95" />
          <stop offset="0.45" stopColor={P.accent200} stopOpacity="0.5" />
          <stop offset="1" stopColor={P.accent100} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.sea} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.brand400} />
          <stop offset="1" stopColor={P.brand700} />
        </linearGradient>
        <clipPath id={id.clip}>
          <rect width="480" height="320" rx="32" />
        </clipPath>
      </defs>
      <g clipPath={id.url('clip')}>
        <rect width="480" height="320" fill={id.url('sky')} />
        <circle cx="352" cy="150" r="110" fill={id.url('sun')} />
        <circle cx="352" cy="150" r="38" fill={P.accent300} />
        <Cloud x={34} y={52} scale={1.3} opacity={0.95} className="animate-drift" />
        <Cloud x={300} y={40} scale={0.9} opacity={0.85} />
        <Cloud x={390} y={96} scale={1.1} opacity={0.9} className="animate-drift" />
        <path d="M0 226c50-24 96-22 140-6 40-26 104-30 152-8 44-16 110-22 188 4v104H0z" fill={P.brand200} opacity="0.85" />
        <path d="M0 246c80-14 160 12 240 0s160-14 240-2v76H0z" fill={id.url('sea')} />
        <path d="M36 270h40M120 286h56M260 272h36M340 292h60M410 268h28" stroke={P.white} strokeWidth="3" strokeLinecap="round" opacity="0.45" />
        <ellipse cx="404" cy="246" rx="58" ry="10" fill={P.accent200} />
        <Palm x={404} y={244} scale={1.1} />
        <Palm x={430} y={246} scale={0.75} flip />
        <path d="M44 168c40-6 84-22 126-44" stroke={P.white} strokeWidth="4" strokeLinecap="round" strokeDasharray="2 10" fill="none" opacity="0.9" />
        <Plane x={160} y={86} scale={1.35} rotate={-12} className="animate-float" />
        <path d="M232 58l6 6 6-6M252 70l4 4 4-4" stroke={P.brand700} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.5" />
        <Sparkle x={86} y={120} size={14} fill={P.white} />
        <Sparkle x={300} y={196} size={10} fill={P.accent300} />
      </g>
    </Svg>
  );
}

/** A friendly hotel with palms and lit windows. 320 × 240. */
export function HotelIllustration({ className }: IllustrationProps) {
  const id = useSvgIds('facade');
  const windows = [0, 1, 2, 3].flatMap((row) => [0, 1, 2, 3].map((col) => ({ row, col, lit: (row * 3 + col) % 5 === 1 })));
  return (
    <Svg viewBox="0 0 320 240" className={className}>
      <defs>
        <linearGradient id={id.facade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.white} />
          <stop offset="1" stopColor={P.brand50} />
        </linearGradient>
      </defs>
      <circle cx="160" cy="120" r="108" fill={P.brand50} />
      <circle cx="248" cy="58" r="20" fill={P.accent200} />
      <Sparkle x={66} y={52} size={12} />
      <ellipse cx="160" cy="212" rx="128" ry="12" fill={P.brand100} />
      <rect x="56" y="112" width="50" height="98" rx="8" fill={P.brand100} />
      <rect x="214" y="112" width="50" height="98" rx="8" fill={P.brand100} />
      <rect x="92" y="54" width="136" height="156" rx="12" fill={id.url('facade')} stroke={P.brand200} strokeWidth="2" />
      <rect x="92" y="54" width="136" height="22" rx="11" fill={P.brand600} />
      {[140, 160, 180].map((cx) => <Sparkle key={cx} x={cx} y={65} size={9} fill={P.accent300} />)}
      {windows.map(({ row, col, lit }) => (
        <rect key={`${row}-${col}`} x={106 + col * 28} y={88 + row * 24} width="20" height="15" rx="4" fill={lit ? P.accent200 : P.brand200} />
      ))}
      <rect x="142" y="178" width="36" height="32" rx="6" fill={P.brand700} />
      <path d="M134 176h52l-5 8c-3 4-6 4-8 0-3 4-6 4-8 0-3 4-6 4-9 0-3 4-6 4-8 0-3 4-6 4-9 0z" fill={P.accent500} />
      {[66, 82].map((x) => <rect key={x} x={x} y="128" width="24" height="14" rx="4" fill={P.white} />)}
      {[224, 240].map((x) => <rect key={x} x={x} y="128" width="24" height="14" rx="4" fill={P.white} />)}
      <Palm x={46} y={212} scale={1.15} />
      <Palm x={276} y={212} scale={1} flip />
      <rect x="186" y="192" width="16" height="18" rx="4" fill={P.accent400} />
      <path d="M190 192v-4h8v4" stroke={P.slate700} strokeWidth="2" fill="none" />
    </Svg>
  );
}

/** A boarding pass with a dotted route. 320 × 200. */
export function BoardingPassIllustration({ className }: IllustrationProps) {
  const id = useSvgIds('band');
  return (
    <Svg viewBox="0 0 320 200" className={className}>
      <defs>
        <linearGradient id={id.band} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={P.brand600} />
          <stop offset="1" stopColor={P.brand500} />
        </linearGradient>
      </defs>
      <ellipse cx="160" cy="104" rx="150" ry="90" fill={P.brand50} />
      <g transform="rotate(-6 160 100)">
        <rect x="36" y="42" width="248" height="124" rx="18" fill={P.ink} opacity="0.06" transform="translate(4 8)" />
        <rect x="36" y="42" width="248" height="124" rx="18" fill={P.white} />
        <path d="M54 42h158v34H36V60a18 18 0 0 1 18-18z" fill={id.url('band')} />
        <Plane x={52} y={46} scale={0.42} body={P.white} wing={P.brand200} tail={P.accent300} />
        <rect x="112" y="54" width="60" height="8" rx="4" fill={P.white} opacity="0.7" />
        <circle cx="212" cy="42" r="9" fill={P.brand50} />
        <circle cx="212" cy="166" r="9" fill={P.brand50} />
        <path d="M212 56v96" stroke={P.slate300} strokeWidth="2" strokeDasharray="4 6" />
        <circle cx="62" cy="108" r="6" fill={P.brand600} />
        <circle cx="186" cy="108" r="6" fill={P.accent500} />
        <path d="M70 104c30-26 78-26 108 0" stroke={P.slate300} strokeWidth="2.5" strokeDasharray="3 7" strokeLinecap="round" fill="none" />
        <rect x="52" y="128" width="46" height="8" rx="4" fill={P.slate200} />
        <rect x="52" y="142" width="30" height="8" rx="4" fill={P.slate200} />
        <rect x="150" y="128" width="46" height="8" rx="4" fill={P.slate200} />
        <rect x="160" y="142" width="36" height="8" rx="4" fill={P.slate200} />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
          <rect key={i} x={228 + i * 4.4} y="70" width={i % 3 === 0 ? 2.6 : 1.6} height="56" rx="0.8" fill={P.slate700} />
        ))}
        <rect x="228" y="136" width="40" height="8" rx="4" fill={P.accent200} />
      </g>
      <Sparkle x={290} y={30} size={14} />
      <Sparkle x={30} y={170} size={10} fill={P.brand300} />
    </Svg>
  );
}

/** A globe with pins and a flight arc. 240 × 240. */
export function GlobeIllustration({ className }: IllustrationProps) {
  const id = useSvgIds('globe', 'clip');
  return (
    <Svg viewBox="0 0 240 240" className={className}>
      <defs>
        <radialGradient id={id.globe} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor={P.brand400} />
          <stop offset="1" stopColor={P.brand700} />
        </radialGradient>
        <clipPath id={id.clip}>
          <circle cx="120" cy="124" r="78" />
        </clipPath>
      </defs>
      <circle cx="120" cy="124" r="108" fill={P.brand50} />
      <ellipse cx="120" cy="124" rx="112" ry="38" fill="none" stroke={P.accent300} strokeWidth="2" strokeDasharray="4 8" transform="rotate(-18 120 124)" />
      <circle cx="120" cy="124" r="78" fill={id.url('globe')} />
      <g clipPath={id.url('clip')}>
        <path d="M60 86c14-10 34-8 40 4s-6 22 6 30 4 26-12 26-30-14-34-32 0-28 0-28z" fill={P.leaf} opacity="0.9" />
        <path d="M128 64c20-6 44 4 52 18s-6 18-18 16-18 10-30 4-24-30-4-38z" fill={P.leaf} opacity="0.9" />
        <path d="M140 140c14-4 30 4 32 18s-12 26-24 22-22-36-8-40z" fill={P.leaf} opacity="0.9" />
        <ellipse cx="120" cy="124" rx="30" ry="78" fill="none" stroke={P.white} strokeOpacity="0.25" strokeWidth="1.5" />
        <path d="M42 124h156M50 92h140M50 156h140" stroke={P.white} strokeOpacity="0.25" strokeWidth="1.5" />
      </g>
      <path d="M84 102c20-40 72-48 92-16" stroke={P.white} strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" fill="none" />
      <Pin x={84} y={104} scale={1.1} fill={P.accent500} />
      <Pin x={176} y={88} scale={0.9} fill={P.white} dot={P.brand600} />
      <Plane x={18} y={176} scale={0.5} rotate={-24} />
      <Sparkle x={204} y={40} size={14} />
      <Sparkle x={36} y={56} size={10} fill={P.brand300} />
    </Svg>
  );
}

/** A travel suitcase with stickers. 200 × 200. */
export function SuitcaseIllustration({ className }: IllustrationProps) {
  const id = useSvgIds('case');
  return (
    <Svg viewBox="0 0 200 200" className={className}>
      <defs>
        <linearGradient id={id.case} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={P.accent400} />
          <stop offset="1" stopColor={P.accent600} />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="88" fill={P.accent50} />
      <ellipse cx="100" cy="178" rx="58" ry="7" fill={P.ink} opacity="0.08" />
      <path d="M78 52V38a8 8 0 0 1 8-8h28a8 8 0 0 1 8 8v14" stroke={P.slate700} strokeWidth="7" fill="none" strokeLinecap="round" />
      <rect x="46" y="52" width="108" height="118" rx="20" fill={id.url('case')} />
      <rect x="70" y="52" width="10" height="118" fill={P.accent600} opacity="0.55" />
      <rect x="120" y="52" width="10" height="118" fill={P.accent600} opacity="0.55" />
      <circle cx="64" cy="172" r="7" fill={P.slate700} />
      <circle cx="136" cy="172" r="7" fill={P.slate700} />
      <g transform="rotate(-12 96 92)">
        <rect x="84" y="80" width="30" height="22" rx="5" fill={P.brand100} />
        <path d="M90 91h18" stroke={P.brand600} strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="104" cy="134" r="14" fill={P.brand600} />
      <Sparkle x={104} y={134} size={14} fill={P.white} />
      <Sparkle x={160} y={44} size={14} fill={P.brand300} />
    </Svg>
  );
}
