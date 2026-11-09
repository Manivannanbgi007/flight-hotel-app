import { Link } from 'react-router';
import { CalendarX2, ChevronDown, CircleHelp, CreditCard, FileText, RotateCcw, type LucideIcon } from 'lucide-react';

import { NoResultsIllustration } from '@/components/illustrations';
import { PageHero } from '@/components/layout/PageHero';
import { Card } from '@/components/ui/Card';
import { FAQ } from './faq';
import { SupportOptions } from './SupportOptions';

/** An icon per FAQ topic (decorative); unknown topics get a question mark. */
const topicIcons: Record<string, LucideIcon> = {
  cancellations: CalendarX2,
  refunds: RotateCcw,
  documents: FileText,
  payments: CreditCard,
};
const iconOf = (id: string): LucideIcon => topicIcons[id] ?? CircleHelp;

/** /help — answers to the common questions (cancellations, refunds, documents, payments) and how to reach support. */
export function HelpPage() {
  return (
    <div className="pb-20">
      <PageHero
        tone="sky"
        eyebrow="Help centre"
        title="Help & Support"
        description={(
          <>
            Answers to the questions we hear most. Your bookings, documents and refunds are in{' '}
            <Link to="/my-trips" className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800">My Trips</Link>.
          </>
        )}
        illustration={<div className="w-52 lg:w-60"><NoResultsIllustration /></div>}
      >
        <nav aria-label="Topics" className="rounded-3xl border border-slate-200/80 bg-white p-3 shadow-xl animate-fade-up sm:p-4">
          <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {FAQ.map((section, index) => {
              const Icon = iconOf(section.id);
              return (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="group flex h-full items-center gap-3 rounded-2xl border border-transparent p-3 text-sm font-bold text-slate-900 transition-colors duration-(--duration-fast) hover:border-brand-100 hover:bg-brand-50"
                  >
                    <span aria-hidden="true" className={index % 2 === 0
                      ? 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100 group-hover:bg-white'
                      : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700 ring-1 ring-accent-100 group-hover:bg-white'}>
                      <Icon className="size-5" />
                    </span>
                    {section.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </PageHero>

      <div className="mx-auto mt-10 grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-10">
          {FAQ.map((section) => {
            const Icon = iconOf(section.id);
            return (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24">
                <h2 id={`${section.id}-heading`} className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                  <Icon className="size-5 text-brand-600" aria-hidden="true" />
                  {section.title}
                </h2>
                <Card className="mt-3 divide-y divide-slate-100">
                  {section.items.map((item) => (
                    <details key={item.question} className="group px-5 py-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                        {item.question}
                        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-[transform,background-color] duration-(--duration-base) group-open:rotate-180 group-open:bg-brand-50 group-open:text-brand-700">
                          <ChevronDown className="size-4" />
                        </span>
                      </summary>
                      <p className="mt-3 text-sm leading-relaxed text-slate-700">{item.answer}</p>
                    </details>
                  ))}
                </Card>
              </section>
            );
          })}
        </div>
        <aside aria-label="Contact support" className="lg:sticky lg:top-24 lg:self-start">
          <SupportOptions />
          <p className="mt-4 text-sm text-slate-600">
            More ways to reach us: <Link to="/contact" className="font-semibold text-brand-700 hover:underline">Contact us</Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
