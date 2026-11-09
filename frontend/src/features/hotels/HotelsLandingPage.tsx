import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ArrowRight, MapPin, Receipt, ShieldCheck, Zap, type LucideIcon } from 'lucide-react';

import { HotelIllustration } from '@/components/illustrations';
import { PageHero } from '@/components/layout/PageHero';
import { Reveal } from '@/components/motion/Reveal';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { queryKeys } from '@/lib/api/queryKeys';
import { hotelApi } from './hotelApi';
import { HotelSearchForm } from './HotelSearchForm';
import { defaultStay, searchParamsOf, EMPTY_FILTERS } from './searchParams';
import type { Stay } from './types';

/** What booking a hotel here gives you: features of the product, never numbers. */
const promises: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Receipt, title: 'Taxes included', text: 'Every price you see already includes the taxes, per night and for the whole stay.' },
  { icon: ShieldCheck, title: 'Free cancellation filter', text: 'Show only rooms you can cancel for free, and see the deadline before you book.' },
  { icon: Zap, title: 'Live availability', text: 'Rooms and prices come straight from the hotel, and your booking updates live.' },
];

/** /hotels: the search form plus the destinations that have hotels. */
export function HotelsLandingPage() {
  const navigate = useNavigate();
  const stay = defaultStay();
  const destinations = useQuery({
    queryKey: queryKeys.hotels.destinations(''),
    queryFn: () => hotelApi.destinations(''),
    staleTime: 5 * 60_000,
  });

  const search = (destination: string, chosen: Stay) =>
    void navigate(`/hotels/search?${searchParamsOf({ destination, stay: chosen, filters: EMPTY_FILTERS }).toString()}`);

  return (
    <div className="pb-16">
      <PageHero
        eyebrow="Hotels"
        title="Find a hotel"
        description="Clear prices with taxes included, free-cancellation filters and live availability."
        illustration={(
          <div className="w-72 rotate-2 rounded-3xl bg-gradient-sky p-5 shadow-2xl ring-4 ring-white/15 lg:w-88">
            <HotelIllustration />
          </div>
        )}
      >
        <Card variant="elevated" className="p-4 sm:p-6">
          <HotelSearchForm stay={stay} onSearch={search} />
        </Card>
      </PageHero>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <ul className="mt-10 grid gap-4 md:grid-cols-3" aria-label="Why book hotels with us">
          {promises.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-xs">
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-900">{title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-slate-600">{text}</span>
              </span>
            </li>
          ))}
        </ul>

        {destinations.isPending && (
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
        )}

        {destinations.data && destinations.data.length > 0 && (
          <Reveal as="section" className="mt-12" aria-labelledby="destinations-heading">
            <h2 id="destinations-heading" className="text-xl font-bold tracking-tight text-slate-900">Destinations</h2>
            <p className="mt-0.5 text-sm text-slate-600">Cities with hotels you can book. Choose one to see prices for a week from today.</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {destinations.data.map((d) => (
                <li key={`${d.city}-${d.countryCode}`}>
                  <button
                    type="button"
                    onClick={() => search(d.city, stay)}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-card hover-lift hover:border-brand-200"
                  >
                    <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-glow">
                      <MapPin className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-slate-900">{d.city}</span>
                      <span className="text-sm text-slate-600">{d.hotels} hotel{d.hotels === 1 ? '' : 's'}</span>
                    </span>
                    <ArrowRight aria-hidden="true"
                      className="size-4 shrink-0 text-slate-400 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </button>
                </li>
              ))}
            </ul>
          </Reveal>
        )}
      </div>
    </div>
  );
}
