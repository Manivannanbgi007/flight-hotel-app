import { Link } from 'react-router';
import { BadgeIndianRupee, BedDouble, FileText, LifeBuoy, Plane, Radio, ShieldCheck, type LucideIcon } from 'lucide-react';

import { Reveal } from '@/components/motion/Reveal';
import { GlobeIllustration } from '@/components/illustrations';
import { PageHero } from '@/components/layout/PageHero';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { usePublicSettings } from '@/features/settings/usePublicSettings';

const POINTS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: BadgeIndianRupee,
    title: 'Clear prices',
    text: 'Taxes and fees are shown before you book, and the cancellation rules are on every offer.',
  },
  {
    icon: ShieldCheck,
    title: 'Safe payments',
    text: "Payments go through our payment provider's secure checkout. Card details are never stored on our servers.",
  },
  {
    icon: LifeBuoy,
    title: 'Real help',
    text: 'Follow every booking live, download your documents, and ask our support team when something is not right.',
  },
];

/** What the service does, as facts (never figures). */
const JOURNEY: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Plane, title: 'Search and compare', text: 'Domestic and international flights and hotels, with filters for price, stops, rating and free cancellation.' },
  { icon: BedDouble, title: 'Book in a few steps', text: 'Guest or passenger details, a clear review, then a secure payment.' },
  { icon: Radio, title: 'Follow it live', text: 'Your booking updates on screen as the hotel or airline confirms it.' },
  { icon: FileText, title: 'Keep everything together', text: 'Confirmations, e-tickets, invoices and receipts stay in your account.' },
];

/** /about — a short, static page about the service. */
export function AboutPage() {
  const { settings } = usePublicSettings();
  return (
    <div className="pb-20">
      <PageHero
        tone="sky"
        eyebrow="Who we are"
        title="About us"
        description={`${settings.siteName} helps you book flights and hotels in one place, with honest prices and support when you need it.`}
        illustration={<div className="w-52 lg:w-60"><GlobeIllustration /></div>}
      />

      <div className="mx-auto max-w-5xl px-4 pt-10 sm:px-6">
        <p className="max-w-3xl text-base leading-relaxed text-slate-700 sm:text-lg">
          Search domestic and international flights and hotels, compare options, pay securely and keep every booking,
          invoice and ticket in your account. Listings marked "Demo" are sample data for trying out the site.
        </p>

        <ul className="mt-8 grid gap-5 stagger sm:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Card className="h-full p-6">
                <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                  <Icon className="size-5" />
                </span>
                <h2 className="mt-4 text-base font-bold text-slate-900">{title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
              </Card>
            </li>
          ))}
        </ul>

        <Reveal as="section" aria-labelledby="about-how" className="mt-14">
          <h2 id="about-how" className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">How it works</h2>
          <ol className="relative mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {JOURNEY.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex flex-col gap-3">
                <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-glow">
                  <Icon className="size-5" />
                </span>
                <h3 className="text-base font-bold text-slate-900">{title}</h3>
                <p className="text-sm leading-relaxed text-slate-600">{text}</p>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal as="section" aria-labelledby="about-contact" className="mt-14">
          <Card variant="tinted" className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <h2 id="about-contact" className="text-lg font-bold text-slate-900">Questions?</h2>
              <p className="mt-1 text-slate-700">
                Read the answers in <Link to="/help" className="font-semibold text-brand-700 underline-offset-2 hover:underline">Help & Support</Link> or{' '}
                <Link to="/contact" className="font-semibold text-brand-700 underline-offset-2 hover:underline">contact us</Link>.
              </p>
            </div>
            <ButtonLink to="/flights" className="self-start sm:self-auto">Start planning a trip</ButtonLink>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
