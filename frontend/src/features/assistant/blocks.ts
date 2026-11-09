/**
 * The structured part of an answer: cards and buttons the SERVER built from the tool results (AI_ASSISTANT.md §7). It is
 * data only. The browser renders it with its own components; nothing in it is HTML, a URL or code, and a button holds a
 * route KEY that `assistantRoutes.ts` maps to a page (a key it does not know is dropped).
 */

export type BlockType =
  | 'BOOKINGS' | 'PAYMENTS' | 'REFUNDS' | 'NOTIFICATIONS' | 'TICKETS' | 'RESERVATIONS' | 'HOTELS' | 'FLIGHTS' | 'OFFERS'
  | 'RECORDS' | 'DETAILS' | 'METRICS' | 'TABLE' | 'STEPS' | 'NOTICE';

export type FieldKind = 'text' | 'date' | 'datetime' | 'money';
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BlockField {
  label: string;
  value: string;
  kind: FieldKind;
}

export interface BlockItem {
  title: string;
  subtitle: string | null;
  badge: string | null;
  tone: Tone;
  fields: BlockField[];
}

export interface BlockMetric {
  label: string;
  value: string;
  kind: FieldKind;
}

export interface BlockSection {
  title: string;
  fields: BlockField[];
}

export interface ChatBlock {
  type: BlockType;
  title: string;
  summary: string | null;
  /** How many records match according to the backend (null = not applicable). */
  total: number | null;
  /** Set when nothing matched ("No matching payments were found."). */
  empty: string | null;
  tone: Tone | null;
  items: BlockItem[];
  metrics: BlockMetric[];
  sections: BlockSection[];
  steps: string[];
  columns: string[];
  rows: string[][];
}

/** A button: a route key of the allowlist, the manager's hotel NAME for hotel pages, and a booking reference to search for. */
export interface ChatAction {
  route: string;
  label: string;
  icon: string;
  hotel: string | null;
  query: string | null;
}

const BLOCK_TYPES: readonly BlockType[] = [
  'BOOKINGS', 'PAYMENTS', 'REFUNDS', 'NOTIFICATIONS', 'TICKETS', 'RESERVATIONS', 'HOTELS', 'FLIGHTS', 'OFFERS', 'RECORDS',
  'DETAILS', 'METRICS', 'TABLE', 'STEPS', 'NOTICE',
];
const TONES: readonly Tone[] = ['neutral', 'info', 'success', 'warning', 'danger'];
const KINDS: readonly FieldKind[] = ['text', 'date', 'datetime', 'money'];

const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const optional = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const tone = (value: unknown): Tone => (TONES.includes(value as Tone) ? (value as Tone) : 'neutral');
const kind = (value: unknown): FieldKind => (KINDS.includes(value as FieldKind) ? (value as FieldKind) : 'text');

function field(value: unknown): BlockField {
  const data = record(value);
  return { label: str(data.label), value: str(data.value), kind: kind(data.kind) };
}

/** Cards from the stream or the saved conversation: untrusted JSON in, typed cards out. Unknown types are dropped. */
export function toBlocks(value: unknown): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  for (const entry of list(value)) {
    const data = record(entry);
    if (!BLOCK_TYPES.includes(data.type as BlockType)) continue;
    blocks.push({
      type: data.type as BlockType,
      title: str(data.title),
      summary: optional(data.summary),
      total: typeof data.total === 'number' ? data.total : null,
      empty: optional(data.empty),
      tone: data.tone ? tone(data.tone) : null,
      items: list(data.items).map((item) => {
        const row = record(item);
        return {
          title: str(row.title),
          subtitle: optional(row.subtitle),
          badge: optional(row.badge),
          tone: tone(row.tone),
          fields: list(row.fields).map(field),
        };
      }),
      metrics: list(data.metrics).map((metric) => {
        const row = record(metric);
        return { label: str(row.label), value: str(row.value), kind: kind(row.kind) };
      }),
      sections: list(data.sections).map((section) => {
        const row = record(section);
        return { title: str(row.title), fields: list(row.fields).map(field) };
      }),
      steps: list(data.steps).map(str),
      columns: list(data.columns).map(str),
      rows: list(data.rows).map((row) => list(row).map(str)),
    });
  }
  return blocks;
}

/** Buttons from the stream or the saved conversation. The route key is checked later, against the allowlist. */
export function toActions(value: unknown): ChatAction[] {
  const actions: ChatAction[] = [];
  for (const entry of list(value)) {
    const data = record(entry);
    const route = str(data.route);
    if (!route) continue;
    actions.push({ route, label: str(data.label) || route, icon: str(data.icon), hotel: optional(data.hotel), query: optional(data.query) });
  }
  return actions;
}
