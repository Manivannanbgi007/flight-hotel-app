import { Link } from 'react-router';
import { Bell, Hash, Luggage } from 'lucide-react';

import { EmptyInboxIllustration } from '@/components/illustrations';
import { PageHero } from '@/components/layout/PageHero';
import { SupportOptions } from './SupportOptions';

/** What helps the support team answer quickly (advice, no promises with figures). */
const TIPS = [
  { icon: Hash, text: 'Give the booking reference, for example from My Trips or your confirmation e-mail.' },
  { icon: Luggage, text: 'Check your booking first: its status, documents and refunds update live.' },
  { icon: Bell, text: 'Answers to tickets appear in your account, and we notify you when one arrives.' },
];

/** /contact — how to reach customer support: a ticket (login), e-mail and phone from the public settings. */
export function ContactPage() {
  return (
    <div className="pb-20">
      <PageHero
        tone="sky"
        eyebrow="We are here to help"
        title="Contact us"
        description={(
          <>
            Many questions are answered in{' '}
            <Link to="/help" className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800">Help &amp; Support</Link>:
            cancellations, refunds, documents and payments.
          </>
        )}
        illustration={<div className="w-52 lg:w-60"><EmptyInboxIllustration /></div>}
      />

      <div className="mx-auto max-w-4xl px-4 pt-10 sm:px-6">
        <SupportOptions layout="grid" />

        <section aria-labelledby="contact-tips" className="mt-10">
          <h2 id="contact-tips" className="text-lg font-bold tracking-tight text-slate-900">Before you write</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {TIPS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-sm leading-relaxed text-slate-700 shadow-card">
                <Icon className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
