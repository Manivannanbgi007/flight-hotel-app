import { useEffect, useState } from 'react';
import { CalendarClock, Check, CheckCircle2, Copy, Tag } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { defaultStay, EMPTY_FILTERS, searchParamsOf } from '@/features/hotels/searchParams';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney } from '@/lib/format';
import type { Offer, OfferTheme } from './offerApi';

/** Token gradients, dark enough for white text (contrast ≥ 4.5:1 on both ends). */
const themes: Record<OfferTheme, string> = {
  OCEAN: 'from-brand-800 to-brand-600',
  SUNSET: 'from-accent-700 to-accent-600',
  FOREST: 'from-success-700 to-success-600',
  CITY: 'from-slate-800 to-slate-600',
};

const appliesToLabels: Record<Offer['appliesTo'], string> = {
  ALL: 'Hotels and flights',
  HOTEL: 'Hotels only',
  FLIGHT: 'Flights only',
};

/** Where to use the offer: a hotel search in its city, or the flight / hotel search pages. */
function searchLinks(offer: Offer): { to: string; label: string }[] {
  const hotels = offer.destinationCity
    ? {
        to: `/hotels/search?${searchParamsOf({ destination: offer.destinationCity, stay: defaultStay(), filters: EMPTY_FILTERS }).toString()}`,
        label: `Find hotels in ${offer.destinationCity}`,
      }
    : { to: '/hotels', label: 'Find a hotel' };
  const flights = { to: '/flights', label: 'Find a flight' };
  if (offer.appliesTo === 'HOTEL') return [hotels];
  if (offer.appliesTo === 'FLIGHT') return [flights];
  return [hotels, flights];
}

/**
 * One offer as a coupon: the discount and title on the theme colour, the conditions and validity, then a perforated
 * edge with the code to copy and where to use it.
 */
export function OfferCard({ offer, headingLevel = 3 }: { offer: Offer; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const conditions = [
    appliesToLabels[offer.appliesTo] ?? offer.appliesTo,
    offer.destinationCity ? `${offer.appliesTo === 'FLIGHT' ? 'Flights to' : 'Stays in'} ${offer.destinationCity}` : null,
    offer.minBookingAmount ? `Bookings of ${formatMoney(offer.minBookingAmount)} or more` : null,
  ].filter((value): value is string => !!value);

  return (
    <Card className="flex h-full flex-col overflow-hidden transition-shadow duration-(--duration-base) hover:shadow-lg">
      <div className={cn('relative isolate overflow-hidden bg-gradient-to-br px-5 pb-5 pt-4 text-white', themes[offer.theme] ?? themes.CITY)}>
        <span aria-hidden="true" className="absolute -right-8 -top-10 -z-10 size-32 rounded-full bg-white/10" />
        <span aria-hidden="true" className="absolute -bottom-12 right-10 -z-10 size-24 rounded-full bg-white/5" />
        <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <Tag className="size-4" aria-hidden="true" /> {offer.discountLabel}
        </p>
        <Heading className="mt-1 text-xl font-bold tracking-tight">{offer.title}</Heading>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pb-4 pt-4">
        {(offer.seasonal || offer.demo) && (
          <div className="flex flex-wrap gap-2">
            {offer.seasonal && <Badge tone="info" dot>Seasonal</Badge>}
            {offer.demo && <Badge tone="warning" title="Sample offer for trying out the site">Demo offer</Badge>}
          </div>
        )}
        {offer.description && <p className="text-sm leading-relaxed text-slate-700">{offer.description}</p>}
        <ul className="flex flex-col gap-1.5 text-sm text-slate-700" aria-label="Conditions">
          {conditions.map((condition) => (
            <li key={condition} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden="true" />
              {condition}
            </li>
          ))}
          <li className="flex items-start gap-2">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
            Valid until {formatDate(offer.validTo)}
          </li>
        </ul>
      </div>

      {/* The perforated edge of the coupon (decorative). */}
      <div aria-hidden="true" className="relative mx-5 border-t-2 border-dashed border-slate-200">
        <span className="absolute -left-8 -top-3 size-6 rounded-full border border-slate-200/80 bg-slate-50" />
        <span className="absolute -right-8 -top-3 size-6 rounded-full border border-slate-200/80 bg-slate-50" />
      </div>

      <div className="flex flex-col gap-3 px-5 pb-5 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-600">Code</span>
          <code className="rounded-lg border-2 border-dashed border-brand-300 bg-brand-50 px-2.5 py-1 font-mono text-base font-bold tracking-widest text-brand-800">
            {offer.couponCode}
          </code>
          <CopyCodeButton code={offer.couponCode} />
        </div>
        <p className="text-xs text-slate-600">Enter the code on the review step when you book.</p>
        <div className="flex flex-wrap gap-2">
          {searchLinks(offer).map((link) => (
            <ButtonLink key={link.to} to={link.to} variant="secondary" size="sm">{link.label}</ButtonLink>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Copies the code; if the browser does not allow it, says so and shows the code to type. */
export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard not available');
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(`Code ${code} copied.`);
    } catch {
      toast.error(`Could not copy. The code is ${code}.`);
    }
  };

  return (
    <Button variant={copied ? 'secondary' : 'primary'} size="sm" className="ml-auto" aria-label={`Copy code ${code}`} onClick={() => void copy()}>
      {copied ? <Check className="size-4 animate-scale-in" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
