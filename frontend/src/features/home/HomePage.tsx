import { useState } from 'react';
import { useNavigate } from 'react-router';
import { BedDouble, Plane } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { defaultFlightSearch, flightQueryOf, type FlightSearch } from '@/features/flights/searchParams';
import { FlightSearchForm } from '@/features/flights/FlightSearchForm';
import { HotelSearchForm } from '@/features/hotels/HotelSearchForm';
import { defaultStay, EMPTY_FILTERS, searchParamsOf } from '@/features/hotels/searchParams';
import type { Stay } from '@/features/hotels/types';
import { HomeHero } from './HomeHero';
import {
  DestinationsSection,
  FaqTeaser,
  FeaturedReviewsSection,
  NextTripBand,
  OffersSection,
  PopularRoutesSection,
  RecentSearchesSection,
  RecommendedHotelsSection,
  WhyBookSection,
} from './HomeSections';
import { useRecentSearches } from './recentSearches';

type SearchTab = 'flights' | 'hotels';

/**
 * Home page (/customer/home; `/` redirects here): the animated hero with a greeting and the flight and hotel search
 * (tabs), what the product offers, then sections filled from the API (offers, destinations, recommended hotels, flight
 * routes, guest reviews), the searches recently made on this device, and a closing band with where to go next. Every
 * section loads and fails on its own, so one missing service never breaks the page; nothing shown here is made up.
 */
export function HomePage() {
  return (
    <div className="pb-20">
      <HomeHero>
        <SearchCard />
      </HomeHero>

      <WhyBookSection />
      <RecentSearchesSection />
      <OffersSection />
      <DestinationsSection />
      <RecommendedHotelsSection />
      <PopularRoutesSection />
      <FeaturedReviewsSection />
      <NextTripBand />
      <FaqTeaser />
    </div>
  );
}

/** One card for both searches: "Flights" and "Hotels" tabs (it opens on the kind of the last search on this device). */
function SearchCard() {
  const navigate = useNavigate();
  const recent = useRecentSearches();
  const [tab, setTab] = useState<SearchTab>(() => (recent[0]?.kind === 'HOTEL' ? 'hotels' : 'flights'));
  const searchHotels = (destination: string, stay: Stay) =>
    void navigate(`/hotels/search?${searchParamsOf({ destination, stay, filters: EMPTY_FILTERS }).toString()}`);
  const searchFlights = (search: FlightSearch) => void navigate(`/flights/search?${flightQueryOf(search).toString()}`);

  return (
    <div className="relative animate-fade-up [animation-delay:200ms]">
      {/* A soft coloured glow behind the card (decorative). */}
      <div aria-hidden="true" className="absolute -inset-x-4 -bottom-6 top-10 -z-10 rounded-3xl bg-gradient-to-r from-brand-400/25 via-violet-400/20 to-accent-300/25 blur-2xl" />
      <Card variant="elevated" className="relative overflow-hidden rounded-3xl p-4 shadow-2xl ring-1 ring-slate-900/5 sm:p-6">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-violet-500 to-accent-500" />
        <Tabs
          label="What would you like to book?"
          variant="pills"
          value={tab}
          onChange={(id) => setTab(id as SearchTab)}
          items={[
            {
              id: 'flights',
              label: <><Plane className="size-4" aria-hidden="true" />Flights</>,
              content: <FlightSearchForm search={defaultFlightSearch()} onSearch={searchFlights} />,
            },
            {
              id: 'hotels',
              label: <><BedDouble className="size-4" aria-hidden="true" />Hotels</>,
              content: <HotelSearchForm stay={defaultStay()} onSearch={searchHotels} />,
            },
          ]}
        />
      </Card>
    </div>
  );
}
