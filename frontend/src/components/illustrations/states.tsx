import { P } from './palette';
import { Cloud, Plane, Sparkle, Svg, type IllustrationProps } from './shapes';
import { useSvgIds } from './useSvgIds';

/** Soft round backdrop shared by the small "state" drawings (empty, error, ...). */
function Backdrop({ fill = P.brand50 }: { fill?: string }) {
  return (
    <>
      <ellipse cx="100" cy="86" rx="84" ry="70" fill={fill} />
      <ellipse cx="100" cy="146" rx="62" ry="6" fill={P.ink} opacity="0.06" />
    </>
  );
}

/** Nothing here yet: an empty tray with a letter floating above. 200 × 160. */
export function EmptyInboxIllustration({ className }: IllustrationProps) {
  return (
    <Svg viewBox="0 0 200 160" className={className}>
      <Backdrop />
      <path d="M50 96h100l-8-36H58z" fill={P.brand100} />
      <rect x="66" y="58" width="68" height="46" rx="6" fill={P.white} />
      <path d="M76 70h48M76 80h36M76 90h42" stroke={P.slate200} strokeWidth="4" strokeLinecap="round" />
      <path d="M42 96h34l6 12h36l6-12h34v34a10 10 0 0 1-10 10H52a10 10 0 0 1-10-10z" fill={P.brand200} />
      <path d="M42 96h34l6 12h36l6-12h34" stroke={P.brand300} strokeWidth="2" fill="none" />
      <g className="animate-float">
        <g transform="rotate(10 140 34)">
          <rect x="122" y="22" width="40" height="28" rx="5" fill={P.white} stroke={P.accent300} strokeWidth="2" />
          <path d="M123 24l19 14 19-14" stroke={P.accent400} strokeWidth="2" fill="none" strokeLinejoin="round" />
        </g>
      </g>
      <Sparkle x={52} y={40} size={12} />
      <Sparkle x={170} y={78} size={8} fill={P.brand300} />
    </Svg>
  );
}

/** No search results: a magnifier over an empty map card. 200 × 160. */
export function NoResultsIllustration({ className }: IllustrationProps) {
  return (
    <Svg viewBox="0 0 200 160" className={className}>
      <Backdrop />
      <g transform="rotate(-5 92 84)">
        <rect x="38" y="40" width="108" height="84" rx="12" fill={P.white} stroke={P.brand100} strokeWidth="2" />
        <path d="M50 108c16-20 30 6 46-14s28-6 40-24" stroke={P.brand200} strokeWidth="3" strokeDasharray="3 6" strokeLinecap="round" fill="none" />
        <circle cx="52" cy="58" r="5" fill={P.brand200} />
        <rect x="64" y="54" width="40" height="8" rx="4" fill={P.slate200} />
      </g>
      <circle cx="118" cy="82" r="28" fill={P.white} fillOpacity="0.7" stroke={P.brand600} strokeWidth="8" />
      <path d="M108 74c2-6 8-8 12-6s5 8 0 11c-3 2-3 4-3 6" stroke={P.slate400} strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <circle cx="117" cy="92" r="2.4" fill={P.slate400} />
      <path d="M138 104l20 20" stroke={P.accent500} strokeWidth="11" strokeLinecap="round" />
      <Sparkle x={160} y={42} size={12} />
    </Svg>
  );
}

/** Lost (404): a signpost pointing both ways and a plane looping. 240 × 180. */
export function LostIllustration({ className }: IllustrationProps) {
  return (
    <Svg viewBox="0 0 240 180" className={className}>
      <ellipse cx="120" cy="92" rx="104" ry="80" fill={P.brand50} />
      <ellipse cx="120" cy="166" rx="70" ry="6" fill={P.ink} opacity="0.07" />
      <Cloud x={20} y={30} scale={0.8} />
      <Cloud x={160} y={56} scale={0.6} fill={P.brand100} />
      <path d="M150 36c30-14 56 6 40 22s-40-4-22-20" stroke={P.brand300} strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" fill="none" />
      <Plane x={176} y={14} scale={0.42} rotate={14} className="animate-float" />
      <rect x="114" y="62" width="10" height="104" rx="5" fill={P.slate400} />
      <path d="M124 72h56l14 12-14 12h-56z" fill={P.accent500} />
      <path d="M114 104H60l-14 12 14 12h54z" fill={P.brand600} />
      <path d="M136 84h30M72 116h28" stroke={P.white} strokeWidth="4" strokeLinecap="round" opacity="0.8" />
      <Sparkle x={52} y={84} size={12} />
    </Svg>
  );
}

/** Something broke: a storm cloud with a lightning bolt. 200 × 160. */
export function StormIllustration({ className }: IllustrationProps) {
  return (
    <Svg viewBox="0 0 200 160" className={className}>
      <Backdrop fill={P.accent50} />
      <path d="M90 92l-12 26h14l-8 26 28-36h-15l10-16z" fill={P.accent400} />
      <Cloud x={40} y={30} scale={1.65} fill={P.slate300} />
      <Cloud x={58} y={44} scale={1.1} fill={P.slate200} />
      <path d="M62 112l-4 10M136 108l-4 10M124 124l-3 8M74 128l-3 8" stroke={P.brand300} strokeWidth="3" strokeLinecap="round" />
      <Sparkle x={162} y={30} size={10} fill={P.accent300} />
    </Svg>
  );
}

/** No access: a shield with a keyhole behind a gate barrier. 240 × 180. */
export function AccessDeniedIllustration({ className }: IllustrationProps) {
  const id = useSvgIds('shield');
  return (
    <Svg viewBox="0 0 240 180" className={className}>
      <defs>
        <linearGradient id={id.shield} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.brand500} />
          <stop offset="1" stopColor={P.brand700} />
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="88" rx="104" ry="80" fill={P.brand50} />
      <ellipse cx="120" cy="166" rx="84" ry="6" fill={P.ink} opacity="0.07" />
      <path d="M120 18l50 18v36c0 34-22 58-50 70-28-12-50-36-50-70V36z" fill={id.url('shield')} />
      <path d="M120 30l38 14v28c0 26-16 46-38 56z" fill={P.white} opacity="0.12" />
      <circle cx="120" cy="72" r="13" fill={P.white} />
      <path d="M115 80h10l4 22h-18z" fill={P.white} />
      <rect x="28" y="120" width="12" height="46" rx="4" fill={P.slate600} />
      <rect x="200" y="120" width="12" height="46" rx="4" fill={P.slate600} />
      <rect x="22" y="126" width="196" height="16" rx="8" fill={P.white} stroke={P.slate300} strokeWidth="2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M${44 + i * 36} 127h16l-10 14h-16z`} fill={P.accent500} />
      ))}
      <Sparkle x={196} y={36} size={14} />
      <Sparkle x={44} y={50} size={10} fill={P.brand300} />
    </Svg>
  );
}

function PaymentCard({ tone }: { tone: 'ok' | 'failed' }) {
  const id = useSvgIds('card');
  return (
    <g transform="rotate(-8 92 88)">
      <defs>
        <linearGradient id={id.card} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tone === 'ok' ? P.brand500 : P.slate400} />
          <stop offset="1" stopColor={tone === 'ok' ? P.brand800 : P.slate600} />
        </linearGradient>
      </defs>
      <rect x="30" y="50" width="124" height="80" rx="14" fill={P.ink} opacity="0.08" transform="translate(3 6)" />
      <rect x="30" y="50" width="124" height="80" rx="14" fill={id.url('card')} />
      <rect x="44" y="70" width="22" height="16" rx="4" fill={P.accent300} />
      <path d="M44 104h30M80 104h20M106 104h20" stroke={P.white} strokeWidth="4" strokeLinecap="round" opacity="0.65" />
      <circle cx="126" cy="72" r="8" fill={P.white} opacity="0.35" />
      <circle cx="136" cy="72" r="8" fill={P.white} opacity="0.2" />
    </g>
  );
}

/** Payment went through: a card with a green tick and confetti. 220 × 170. */
export function PaymentSuccessIllustration({ className }: IllustrationProps) {
  return (
    <Svg viewBox="0 0 220 170" className={className}>
      <ellipse cx="110" cy="88" rx="96" ry="76" fill={P.success100} opacity="0.7" />
      <ellipse cx="104" cy="160" rx="70" ry="6" fill={P.ink} opacity="0.07" />
      <PaymentCard tone="ok" />
      <circle cx="160" cy="112" r="26" fill={P.success500} stroke={P.white} strokeWidth="5" />
      <path d="M148 112l8 8 16-16" stroke={P.white} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="34" y="22" width="8" height="8" rx="2" fill={P.accent400} transform="rotate(20 38 26)" />
      <rect x="172" y="30" width="8" height="8" rx="2" fill={P.brand400} transform="rotate(-15 176 34)" />
      <circle cx="190" cy="70" r="4" fill={P.accent300} />
      <circle cx="20" cy="96" r="4" fill={P.brand300} />
      <Sparkle x={120} y={22} size={14} />
    </Svg>
  );
}

/** Payment failed: a grey card with a red cross. 220 × 170. */
export function PaymentFailedIllustration({ className }: IllustrationProps) {
  return (
    <Svg viewBox="0 0 220 170" className={className}>
      <ellipse cx="110" cy="88" rx="96" ry="76" fill={P.danger100} opacity="0.6" />
      <ellipse cx="104" cy="160" rx="70" ry="6" fill={P.ink} opacity="0.07" />
      <PaymentCard tone="failed" />
      <circle cx="160" cy="112" r="26" fill={P.danger500} stroke={P.white} strokeWidth="5" />
      <path d="M151 103l18 18M169 103l-18 18" stroke={P.white} strokeWidth="6" strokeLinecap="round" />
      <path d="M186 50l-6 12h8l-6 12" stroke={P.accent400} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="26" cy="40" r="4" fill={P.slate300} />
    </Svg>
  );
}
