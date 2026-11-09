import { useNavigate } from 'react-router';
import { BadgeCheck, Luggage, Plane, Radio, ShieldCheck, type LucideIcon } from 'lucide-react';

import { BoardingPassIllustration } from '@/components/illustrations';
import { PageHero } from '@/components/layout/PageHero';
import { Reveal } from '@/components/motion/Reveal';
import { Card } from '@/components/ui/Card';
import { FlightSearchForm } from './FlightSearchForm';
import { PopularRoutes } from './PopularRoutes';
import { defaultFlightSearch, flightQueryOf, type FlightSearch } from './searchParams';

/** What booking a flight here includes (product facts, never numbers). */
const PROMISES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Luggage, title: 'Baggage shown up front', text: 'Check-in and cabin allowances are on every fare before you choose it.' },
  { icon: BadgeCheck, title: 'Clear fare rules', text: 'Refundable and non-refundable fares are labelled, with the cancellation fee in words.' },
  { icon: ShieldCheck, title: 'Secure payment', text: 'Your seats are held while you pay, and the price is checked again before booking.' },
  { icon: Radio, title: 'Live booking updates', text: 'Follow the confirmation from the airline and every change in My Trips.' },
];

/** /flights: the search form in an illustrated hero, then popular routes and what a booking includes. */
export function FlightsLandingPage() {
  const navigate = useNavigate();
  const search = (chosen: FlightSearch) => void navigate(`/flights/search?${flightQueryOf(chosen).toString()}`);
  return (
    <div className="pb-16">
      <PageHero
        eyebrow={<><Plane className="size-3.5" aria-hidden="true" /> Flights</>}
        title="Find a flight"
        description="One-way and round trips in every cabin, with baggage and cancellation rules shown before you book."
        illustration={<BoardingPassIllustration className="w-64 lg:w-80" />}
      >
        <Card variant="elevated" className="p-5 animate-fade-up sm:p-6">
          <FlightSearchForm search={defaultFlightSearch()} onSearch={search} />
        </Card>
      </PageHero>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mt-12">
          <PopularRoutes />
        </div>

        <Reveal as="section" aria-labelledby="flight-promises-heading" className="mt-14">
          <h2 id="flight-promises-heading" className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">Every flight booking includes</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
                <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <Icon className="size-5" />
                </span>
                <h3 className="text-base font-bold text-slate-900">{title}</h3>
                <p className="text-sm leading-relaxed text-slate-600">{text}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </div>
  );
}
