import type { ComponentType, ReactNode } from 'react';
import {
  AlertTriangle, BarChart3, Bell, Building2, CircleSlash, ClipboardList, FileText, Hotel, Info, LifeBuoy, ListOrdered, Luggage,
  Plane, Table2, Tag, Undo2, Wallet,
} from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { BlockField, BlockItem, BlockType, ChatBlock } from './blocks';
import { formatValue } from './blockFormat';

const ICONS: Record<BlockType, ComponentType<{ className?: string }>> = {
  BOOKINGS: Luggage,
  PAYMENTS: Wallet,
  REFUNDS: Undo2,
  NOTIFICATIONS: Bell,
  TICKETS: LifeBuoy,
  RESERVATIONS: ClipboardList,
  HOTELS: Building2,
  FLIGHTS: Plane,
  OFFERS: Tag,
  RECORDS: Hotel,
  DETAILS: FileText,
  METRICS: BarChart3,
  TABLE: Table2,
  STEPS: ListOrdered,
  NOTICE: Info,
};

/** Accent of each kind of card (icon tile): the app's own colours. */
const ACCENTS: Record<BlockType, string> = {
  BOOKINGS: 'bg-info-50 text-info-600 ring-info-100',
  PAYMENTS: 'bg-success-50 text-success-600 ring-success-100',
  REFUNDS: 'bg-warning-50 text-warning-600 ring-warning-100',
  NOTIFICATIONS: 'bg-warning-50 text-warning-600 ring-warning-100',
  TICKETS: 'bg-accent-50 text-accent-600 ring-accent-100',
  RESERVATIONS: 'bg-role-50 text-role-600 ring-role-100',
  HOTELS: 'bg-brand-50 text-brand-600 ring-brand-100',
  FLIGHTS: 'bg-info-50 text-info-600 ring-info-100',
  OFFERS: 'bg-danger-50 text-danger-600 ring-danger-100',
  RECORDS: 'bg-role-50 text-role-600 ring-role-100',
  DETAILS: 'bg-role-50 text-role-600 ring-role-100',
  METRICS: 'bg-brand-50 text-brand-600 ring-brand-100',
  TABLE: 'bg-slate-100 text-slate-700 ring-slate-200',
  STEPS: 'bg-role-50 text-role-600 ring-role-100',
  NOTICE: 'bg-info-50 text-info-600 ring-info-100',
};

/**
 * The cards of an answer. Everything shown comes from the server's tool results; this only lays it out. All text is
 * rendered as text (React escapes it): no HTML, no links.
 */
export function AnswerBlocks({ blocks }: { blocks: ChatBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="answer-blocks">
      {blocks.map((block, index) => (
        <BlockCard key={`${block.type}-${index}`} block={block} />
      ))}
    </div>
  );
}

function BlockCard({ block }: { block: ChatBlock }) {
  if (block.type === 'NOTICE') return <Notice block={block} />;
  const Icon = ICONS[block.type];
  return (
    <section aria-label={block.title} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
      <header className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50/70 px-3.5 py-2.5">
        <span aria-hidden="true" className={cn('flex size-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', ACCENTS[block.type])}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-slate-900">{block.title}</h3>
          {block.summary && block.type !== 'DETAILS' && <p className="truncate text-xs text-slate-600">{block.summary}</p>}
        </div>
        {block.type === 'DETAILS' && block.summary && <Badge tone={block.tone ?? 'neutral'} dot>{block.summary}</Badge>}
      </header>
      <div className="p-3">
        <BlockBody block={block} />
      </div>
    </section>
  );
}

function BlockBody({ block }: { block: ChatBlock }): ReactNode {
  switch (block.type) {
    case 'STEPS':
      return (
        <ol aria-label={block.title} className="flex flex-col gap-2">
          {block.steps.map((step, index) => (
            <li key={step} className="flex items-start gap-2.5 text-sm text-slate-800">
              <span aria-hidden="true" className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-role-600 text-xs font-bold text-white">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      );
    case 'METRICS':
      return (
        <dl className="grid grid-cols-2 gap-2">
          {block.metrics.map((metric) => (
            <div key={metric.label} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200/70">
              <dt className="truncate text-xs text-slate-600">{metric.label}</dt>
              <dd className="mt-0.5 break-words text-base font-bold text-slate-900 [overflow-wrap:anywhere]">{formatValue(metric.value, metric.kind)}</dd>
            </div>
          ))}
          {block.metrics.length === 0 && <p className="col-span-2 text-sm text-slate-600">No figures were returned.</p>}
        </dl>
      );
    case 'DETAILS':
      return (
        <div className="flex flex-col gap-3">
          {block.sections.map((section) => (
            <div key={section.title}>
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">{section.title}</h4>
              <Fields fields={section.fields} />
            </div>
          ))}
        </div>
      );
    case 'TABLE':
      return <ReportTable block={block} />;
    default:
      return block.items.length === 0 ? (
        <EmptyCard text={block.empty ?? 'No matching records were found.'} />
      ) : (
        <ul className="flex flex-col gap-2">
          {block.items.map((item, index) => (
            <ItemCard key={`${item.title}-${index}`} item={item} />
          ))}
        </ul>
      );
  }
}

function Fields({ fields }: { fields: BlockField[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {fields.map((field, index) => (
        <div key={`${field.label}-${index}`} className="contents">
          <dt className="text-slate-600">{field.label}</dt>
          <dd className={cn('font-medium text-slate-900 [overflow-wrap:anywhere]', field.kind === 'money' && 'tabular-nums')}>
            {formatValue(field.value, field.kind)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ItemCard({ item }: { item: BlockItem }) {
  return (
    <li className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200 transition-shadow hover:shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{item.title}</p>
          {item.subtitle && <p className="line-clamp-2 break-words text-xs text-slate-600 [overflow-wrap:anywhere]">{item.subtitle}</p>}
        </div>
        {item.badge && <Badge tone={item.tone} dot>{item.badge}</Badge>}
      </div>
      {item.fields.length > 0 && (
        <div className="mt-2">
          <Fields fields={item.fields} />
        </div>
      )}
    </li>
  );
}

function ReportTable({ block }: { block: ChatBlock }) {
  return (
    <div className="flex flex-col gap-2">
      {block.metrics.length > 0 && (
        <dl className="grid grid-cols-2 gap-2">
          {block.metrics.map((metric) => (
            <div key={metric.label} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200/70">
              <dt className="truncate text-xs text-slate-600">{metric.label}</dt>
              <dd className="mt-0.5 break-words text-sm font-bold text-slate-900">{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {block.rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="min-w-full text-xs">
            <caption className="sr-only">{block.title}</caption>
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>{block.columns.map((column) => <th key={column} scope="col" className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{column}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {block.rows.map((row, index) => (
                <tr key={index}>{row.map((cell, i) => <td key={i} className="whitespace-nowrap px-2.5 py-1.5 text-slate-800">{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        block.metrics.length === 0 && <EmptyCard text="No matching records were found." />
      )}
    </div>
  );
}

/** "Nothing matched": said plainly, with a calm icon. */
function EmptyCard({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200/70">
      <CircleSlash className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
      {text}
    </p>
  );
}

function Notice({ block }: { block: ChatBlock }) {
  const warning = block.tone === 'warning' || block.tone === 'danger';
  const Icon = warning ? AlertTriangle : Info;
  return (
    <div
      role={warning ? 'alert' : 'status'}
      className={cn('flex gap-2.5 rounded-2xl px-3.5 py-3 text-sm shadow-xs ring-1',
        warning ? 'bg-warning-50 text-warning-700 ring-warning-200' : 'bg-info-50 text-info-700 ring-info-200')}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">{block.title}</p>
        {block.summary && <p className="mt-0.5 [overflow-wrap:anywhere]">{block.summary}</p>}
      </div>
    </div>
  );
}
