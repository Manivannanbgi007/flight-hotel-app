/**
 * The structured part of an answer: cards and buttons the SERVER built from the tool results (AI_ASSISTANT.md §7). It is
 * data only. The browser renders it with its own components; nothing in it is HTML, a URL or code, and a button holds a
 * route KEY that `assistantRoutes.js` maps to a page (a key it does not know is dropped).
 */

const BLOCK_TYPES = [
  'BOOKINGS',
  'PAYMENTS',
  'REFUNDS',
  'NOTIFICATIONS',
  'TICKETS',
  'RESERVATIONS',
  'HOTELS',
  'FLIGHTS',
  'OFFERS',
  'RECORDS',
  'DETAILS',
  'METRICS',
  'TABLE',
  'STEPS',
  'NOTICE',
];
const TONES = ['neutral', 'info', 'success', 'warning', 'danger'];
const KINDS = ['text', 'date', 'datetime', 'money'];

const str = (value) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const optional = (value) => (typeof value === 'string' && value !== '' ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const record = (value) => (value && typeof value === 'object' ? value : {});
const tone = (value) => (TONES.includes(value) ? value : 'neutral');
const kind = (value) => (KINDS.includes(value) ? value : 'text');

function field(value) {
  const data = record(value);
  return { label: str(data.label), value: str(data.value), kind: kind(data.kind) };
}

/** Cards from the stream or the saved conversation: untrusted JSON in, typed cards out. Unknown types are dropped. */
export function toBlocks(value) {
  const blocks = [];
  for (const entry of list(value)) {
    const data = record(entry);
    if (!BLOCK_TYPES.includes(data.type)) continue;
    blocks.push({
      type: data.type,
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
export function toActions(value) {
  const actions = [];
  for (const entry of list(value)) {
    const data = record(entry);
    const route = str(data.route);
    if (!route) continue;
    actions.push({
      route,
      label: str(data.label) || route,
      icon: str(data.icon),
      hotel: optional(data.hotel),
      query: optional(data.query),
    });
  }
  return actions;
}
