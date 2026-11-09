import { differenceInCalendarDays, parseISO } from 'date-fns';

import { formatShortDate } from '@/lib/format';
import type { Passengers } from './types';

/** Local times come as `2027-01-10T06:45`; these helpers never create a Date (no time-zone surprises). */
export const timeOf = (local: string): string => local.slice(11, 16);
export const dateOf = (local: string): string => local.slice(0, 10);

/** 130 → "2h 10m", 45 → "45m", 120 → "2h". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "Non-stop", "1 stop via HYD". */
export function stopsLabel(stops: number, via: string | null): string {
  if (stops === 0) return 'Non-stop';
  return `${stops} stop${stops === 1 ? '' : 's'}${via ? ` via ${via}` : ''}`;
}

/** "+1 day" when the flight lands on a later calendar day (local dates). */
export function arrivalDayOffset(departureLocal: string, arrivalLocal: string): string {
  const days = differenceInCalendarDays(parseISO(dateOf(arrivalLocal)), parseISO(dateOf(departureLocal)));
  return days > 0 ? `+${days} day${days === 1 ? '' : 's'}` : '';
}

/** "Fri, 10 Jan 06:45". */
export function dateTimeLabel(local: string): string {
  return `${formatShortDate(dateOf(local))} ${timeOf(local)}`;
}

export function describePassengers(passengers: Passengers): string {
  const parts = [`${passengers.adults} adult${passengers.adults === 1 ? '' : 's'}`];
  if (passengers.children > 0) parts.push(`${passengers.children} child${passengers.children === 1 ? '' : 'ren'}`);
  if (passengers.infants > 0) parts.push(`${passengers.infants} infant${passengers.infants === 1 ? '' : 's'}`);
  return parts.join(', ');
}

export function baggageLabel(checkedKg: number, cabinKg: number): string {
  return `Check-in ${checkedKg} kg · Cabin ${cabinKg} kg`;
}

/** Layover between two consecutive segments, in minutes. */
export function layoverMinutes(arrivalLocal: string, nextDepartureLocal: string): number {
  const toMinutes = (local: string) => {
    const [h = 0, m = 0] = timeOf(local).split(':').map(Number);
    return differenceInCalendarDays(parseISO(dateOf(local)), parseISO('2000-01-01')) * 1440 + h * 60 + m;
  };
  return toMinutes(nextDepartureLocal) - toMinutes(arrivalLocal);
}
