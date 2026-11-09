import { P } from './palette';
import { Cloud, Palm, Plane, Sparkle, Svg, type IllustrationProps } from './shapes';
import { useSvgIds } from './useSvgIds';

/** Customer sign-in: a round window onto a sunset flight, a boarding pass and a suitcase in front. 480 × 400. */
export function CustomerSignInIllustration({ className }: IllustrationProps) {
  const id = useSvgIds('sky', 'sun', 'sea', 'clip', 'case');
  return (
    <Svg viewBox="0 0 480 400" className={className}>
      <defs>
        <linearGradient id={id.sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.brand300} />
          <stop offset="0.5" stopColor={P.brand100} />
          <stop offset="1" stopColor={P.accent200} />
        </linearGradient>
        <radialGradient id={id.sun} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={P.accent200} />
          <stop offset="1" stopColor={P.accent200} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id.sea} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.brand400} />
          <stop offset="1" stopColor={P.brand700} />
        </linearGradient>
        <linearGradient id={id.case} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={P.accent400} />
          <stop offset="1" stopColor={P.accent600} />
        </linearGradient>
        <clipPath id={id.clip}>
          <circle cx="240" cy="180" r="150" />
        </clipPath>
      </defs>
      <circle cx="240" cy="180" r="172" fill={P.white} opacity="0.14" />
      <g clipPath={id.url('clip')}>
        <rect x="80" y="20" width="320" height="320" fill={id.url('sky')} />
        <circle cx="300" cy="190" r="80" fill={id.url('sun')} />
        <circle cx="300" cy="190" r="34" fill={P.accent300} />
        <Cloud x={110} y={70} scale={1.2} className="animate-drift" />
        <Cloud x={290} y={96} scale={0.8} opacity={0.9} />
        <path d="M80 236c50-18 90-10 130 2 44-20 110-24 190-4v106H80z" fill={P.brand200} />
        <path d="M80 256c60-12 120 10 180 0s100-12 140-4v80H80z" fill={id.url('sea')} />
        <path d="M120 284h34M200 300h46M300 282h40" stroke={P.white} strokeWidth="3" strokeLinecap="round" opacity="0.5" />
        <path d="M110 196c40-8 80-28 112-56" stroke={P.white} strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" fill="none" />
        <Plane x={206} y={96} scale={1.15} rotate={-16} className="animate-float" />
      </g>
      <circle cx="240" cy="180" r="150" fill="none" stroke={P.white} strokeOpacity="0.7" strokeWidth="6" />
      <g transform="rotate(-10 120 318)">
        <rect x="40" y="276" width="168" height="84" rx="14" fill={P.ink} opacity="0.12" transform="translate(4 8)" />
        <rect x="40" y="276" width="168" height="84" rx="14" fill={P.white} />
        <path d="M54 276h96v24H40v-10a14 14 0 0 1 14-14z" fill={P.brand600} />
        <path d="M150 276v84" stroke={P.slate300} strokeWidth="2" strokeDasharray="3 5" />
        <circle cx="62" cy="324" r="5" fill={P.brand600} />
        <circle cx="130" cy="324" r="5" fill={P.accent500} />
        <path d="M68 320c18-14 40-14 56 0" stroke={P.slate300} strokeWidth="2" strokeDasharray="3 5" fill="none" />
        <rect x="54" y="340" width="40" height="6" rx="3" fill={P.slate200} />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} x={162 + i * 5} y="296" width={i % 2 ? 1.6 : 2.8} height="44" fill={P.slate700} />)}
      </g>
      <g transform="rotate(6 380 310)">
        <path d="M362 262v-12a7 7 0 0 1 7-7h22a7 7 0 0 1 7 7v12" stroke={P.slate700} strokeWidth="6" fill="none" />
        <rect x="336" y="262" width="88" height="96" rx="16" fill={id.url('case')} />
        <rect x="356" y="262" width="8" height="96" fill={P.accent600} opacity="0.5" />
        <rect x="396" y="262" width="8" height="96" fill={P.accent600} opacity="0.5" />
        <circle cx="380" cy="300" r="12" fill={P.brand600} />
        <Sparkle x={380} y={300} size={12} fill={P.white} />
      </g>
      <Palm x={430} y={250} scale={1.3} flip />
      <Sparkle x={70} y={70} size={18} fill={P.white} />
      <Sparkle x={420} y={60} size={14} fill={P.accent300} />
      <Sparkle x={60} y={220} size={10} fill={P.accent200} />
    </Svg>
  );
}

/** Admin sign-in: an analytics dashboard window with KPI tiles, columns, a donut and a trend card. 480 × 400. */
export function AdminSignInIllustration({ className }: IllustrationProps) {
  const id = useSvgIds('glow');
  const circumference = 2 * Math.PI * 30;
  const shares = [
    { share: 0.55, color: P.indigo600 },
    { share: 0.28, color: P.accent400 },
    { share: 0.17, color: P.teal400 },
  ];
  const arcs = shares.map((arc, index) => ({
    ...arc,
    offset: shares.slice(0, index).reduce((sum, previous) => sum + previous.share * circumference, 0),
  }));
  return (
    <Svg viewBox="0 0 480 400" className={className}>
      <defs>
        <radialGradient id={id.glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={P.indigo300} stopOpacity="0.55" />
          <stop offset="1" stopColor={P.indigo300} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="240" cy="200" r="190" fill={id.url('glow')} />
      <rect x="70" y="84" width="320" height="226" rx="22" fill={P.ink} opacity="0.14" transform="translate(6 12)" />
      <rect x="70" y="84" width="320" height="226" rx="22" fill={P.white} />
      <path d="M92 84h276a22 22 0 0 1 22 22v8H70v-8a22 22 0 0 1 22-22z" fill={P.indigo100} />
      {[P.accent400, P.warning500, P.success500].map((fill, i) => <circle key={fill} cx={92 + i * 14} cy={100} r={4.5} fill={fill} />)}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={90 + i * 98} y="128" width="86" height="50" rx="12" fill={P.indigo100} opacity={0.6} />
          <rect x={102 + i * 98} y="140" width="34" height="6" rx="3" fill={P.slate300} />
          <rect x={102 + i * 98} y="154" width="52" height="11" rx="5" fill={[P.indigo600, P.accent500, P.teal600][i]} />
        </g>
      ))}
      <path d="M90 288h176" stroke={P.slate200} strokeWidth="2" />
      {[44, 66, 52, 84, 70, 96, 88].map((h, i) => (
        <g key={i}>
          <rect x={98 + i * 24} y={288 - h} width="14" height={h} rx="4" fill={i === 6 ? P.indigo600 : P.indigo300} />
        </g>
      ))}
      <g transform="rotate(-90 326 244)">
        <circle cx="326" cy="244" r="30" fill="none" stroke={P.indigo100} strokeWidth="14" />
        {arcs.map(({ share, color, offset }) => (
          <circle key={color} cx="326" cy="244" r="30" fill="none" stroke={color} strokeWidth="14"
            strokeDasharray={`${share * circumference - 3} ${circumference}`} strokeDashoffset={-offset} />
        ))}
      </g>
      <g className="animate-float">
        <rect x="318" y="34" width="132" height="76" rx="16" fill={P.ink} opacity="0.12" transform="translate(4 8)" />
        <rect x="318" y="34" width="132" height="76" rx="16" fill={P.white} />
        <polyline points="332,92 352,80 370,86 390,64 410,70 434,48" fill="none" stroke={P.accent500} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="434" cy="48" r="5" fill={P.accent500} stroke={P.white} strokeWidth="2" />
        <rect x="332" y="46" width="40" height="6" rx="3" fill={P.slate200} />
      </g>
      <g>
        <rect x="26" y="262" width="122" height="74" rx="16" fill={P.ink} opacity="0.12" transform="translate(4 8)" />
        <rect x="26" y="262" width="122" height="74" rx="16" fill={P.white} />
        {[0, 1, 2].map((i) => <circle key={i} cx={52 + i * 22} cy="290" r="12" fill={[P.indigo400, P.accent300, P.teal300][i]} stroke={P.white} strokeWidth="3" />)}
        <rect x="42" y="312" width="70" height="7" rx="3.5" fill={P.slate200} />
        <path d="M122 296l8-8 8 8" stroke={P.success500} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
      <Sparkle x={52} y={74} size={18} fill={P.white} />
      <Sparkle x={430} y={168} size={14} fill={P.accent300} />
      <Sparkle x={250} y={360} size={12} fill={P.indigo200} />
    </Svg>
  );
}

/** Hotel manager sign-in: a hotel front desk with a key board, a clock, a monitor and a service bell. 480 × 400. */
export function ManagerSignInIllustration({ className }: IllustrationProps) {
  const id = useSvgIds('bell', 'wall');
  return (
    <Svg viewBox="0 0 480 400" className={className}>
      <defs>
        <linearGradient id={id.bell} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={P.accent200} />
          <stop offset="1" stopColor={P.accent500} />
        </linearGradient>
        <linearGradient id={id.wall} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.teal100} />
          <stop offset="1" stopColor={P.white} />
        </linearGradient>
      </defs>
      <rect x="40" y="30" width="400" height="300" rx="32" fill={id.url('wall')} />
      <rect x="84" y="70" width="128" height="98" rx="14" fill={P.teal800} />
      {[0, 1].flatMap((row) => [0, 1, 2, 3].map((col) => {
        const x = 104 + col * 28;
        const y = 88 + row * 42;
        const tag = (row + col) % 2 === 0 ? P.accent300 : P.teal300;
        return (
          <g key={`${row}-${col}`}>
            <circle cx={x} cy={y} r="3" fill={P.teal200} />
            <path d={`M${x} ${y}v8`} stroke={P.teal200} strokeWidth="2" />
            <rect x={x - 6} y={y + 8} width="12" height="18" rx="4" fill={tag} />
          </g>
        );
      }))}
      <rect x="244" y="74" width="84" height="64" rx="10" fill={P.white} stroke={P.teal300} strokeWidth="4" />
      <circle cx="304" cy="94" r="9" fill={P.accent300} />
      <path d="M248 134l26-30 18 18 12-10 20 22z" fill={P.teal400} />
      <circle cx="384" cy="104" r="32" fill={P.white} stroke={P.teal700} strokeWidth="5" />
      <path d="M384 84v20l14 10" stroke={P.teal800} strokeWidth="4" strokeLinecap="round" fill="none" />
      <g>
        <rect x="114" y="168" width="96" height="66" rx="10" fill={P.slate800} />
        <rect x="124" y="180" width="44" height="7" rx="3.5" fill={P.teal300} />
        <rect x="124" y="194" width="70" height="6" rx="3" fill={P.slate600} />
        <rect x="124" y="206" width="58" height="6" rx="3" fill={P.slate600} />
        <rect x="156" y="234" width="12" height="14" fill={P.slate600} />
      </g>
      <ellipse cx="330" cy="244" rx="34" ry="6" fill={P.slate700} />
      <path d="M300 242a30 30 0 0 1 60 0z" fill={id.url('bell')} />
      <rect x="326" y="202" width="8" height="10" rx="3" fill={P.slate700} />
      <path d="M314 226c4-8 10-12 16-12" stroke={P.white} strokeWidth="3" strokeLinecap="round" opacity="0.7" fill="none" />
      <rect x="34" y="246" width="412" height="20" rx="10" fill={P.teal800} />
      <rect x="52" y="264" width="376" height="104" rx="16" fill={P.teal600} />
      {[0, 1, 2, 3].map((i) => <rect key={i} x={74 + i * 92} y="282" width="72" height="68" rx="10" fill={P.teal500} opacity="0.55" />)}
      <rect x="196" y="300" width="88" height="30" rx="8" fill={P.accent300} />
      {[222, 240, 258].map((x) => <Sparkle key={x} x={x} y={315} size={10} fill={P.white} />)}
      <rect x="400" y="208" width="28" height="38" rx="6" fill={P.accent500} />
      <path d="M414 208c-4-18-16-24-24-22 6 6 12 14 24 22zM414 208c2-20 12-28 22-28-4 8-10 18-22 28zM414 208c-12-6-24-2-28 6 10-2 18-2 28-6z" fill={P.leaf} />
      <g className="animate-float">
        <rect x="64" y="196" width="40" height="26" rx="6" fill={P.white} stroke={P.teal300} strokeWidth="2" transform="rotate(-12 84 209)" />
      </g>
      <Sparkle x={440} y={40} size={16} fill={P.accent300} />
      <Sparkle x={30} y={140} size={12} fill={P.white} />
    </Svg>
  );
}

/** Support sign-in: a headset between chat bubbles. 480 × 400. */
export function SupportSignInIllustration({ className }: IllustrationProps) {
  const id = useSvgIds('cup');
  return (
    <Svg viewBox="0 0 480 400" className={className}>
      <defs>
        <linearGradient id={id.cup} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.violet500} />
          <stop offset="1" stopColor={P.violet700} />
        </linearGradient>
      </defs>
      <circle cx="236" cy="214" r="170" fill={P.violet100} opacity="0.55" />
      <circle cx="236" cy="226" r="112" fill={P.violet200} opacity="0.8" />
      <path d="M152 238a84 84 0 0 1 168 0" stroke={P.violet700} strokeWidth="18" strokeLinecap="round" fill="none" />
      <path d="M160 226a76 76 0 0 1 152 0" stroke={P.violet400} strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.6" />
      <rect x="124" y="216" width="46" height="80" rx="20" fill={id.url('cup')} />
      <rect x="302" y="216" width="46" height="80" rx="20" fill={id.url('cup')} />
      <rect x="154" y="226" width="16" height="60" rx="8" fill={P.violet300} />
      <rect x="302" y="226" width="16" height="60" rx="8" fill={P.violet300} />
      <path d="M326 294c0 30-24 46-62 46" stroke={P.violet700} strokeWidth="8" strokeLinecap="round" fill="none" />
      <rect x="232" y="328" width="36" height="22" rx="11" fill={P.accent400} />
      <g className="animate-float">
        <path d="M58 70h120a22 22 0 0 1 22 22v34a22 22 0 0 1-22 22H96l-22 18v-18H58a22 22 0 0 1-22-22V92a22 22 0 0 1 22-22z" fill={P.white} />
        {[86, 112, 138].map((cx, i) => <circle key={cx} cx={cx} cy="109" r="8" fill={i === 1 ? P.violet500 : P.violet300} />)}
      </g>
      <path d="M306 92h132a22 22 0 0 1 22 22v40a22 22 0 0 1-22 22h-10v18l-22-18h-100a22 22 0 0 1-22-22v-40a22 22 0 0 1 22-22z" fill={P.violet600} />
      <rect x="306" y="114" width="104" height="9" rx="4.5" fill={P.white} opacity="0.9" />
      <rect x="306" y="134" width="132" height="9" rx="4.5" fill={P.white} opacity="0.6" />
      <rect x="306" y="154" width="72" height="9" rx="4.5" fill={P.white} opacity="0.6" />
      <circle cx="404" cy="300" r="30" fill={P.accent400} />
      <path d="M404 314s-14-8-14-17a8 8 0 0 1 14-5 8 8 0 0 1 14 5c0 9-14 17-14 17z" fill={P.white} />
      <circle cx="72" cy="290" r="24" fill={P.success500} />
      <path d="M61 290l7 7 14-14" stroke={P.white} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Sparkle x={236} y={40} size={18} fill={P.white} />
      <Sparkle x={448} y={236} size={12} fill={P.accent300} />
      <Sparkle x={32} y={200} size={12} fill={P.violet300} />
    </Svg>
  );
}
