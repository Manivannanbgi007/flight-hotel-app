import { useSearchParams } from 'react-router';

import { todayIso } from '@/features/account/schemas';
import { readRange, writeRange } from './dateRange';
import type { DateRangeQuery, ReservationRow, ReservationStatus, ReviewStatus } from './operationsTypes';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** How each reservation status reads for the hotel. */
export const reservationStatusInfo: Record<ReservationStatus, { label: string; tone: Tone }> = {
  HELD: { label: 'Held, not paid yet', tone: 'neutral' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  CHECKED_IN: { label: 'Checked in', tone: 'info' },
  CHECKED_OUT: { label: 'Checked out', tone: 'neutral' },
  NO_SHOW: { label: 'No-show', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  RELEASED: { label: 'Released', tone: 'neutral' },
};

export const RESERVATION_STATUSES = Object.keys(reservationStatusInfo) as ReservationStatus[];

export const reviewStatusInfo: Record<ReviewStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Published', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

export const REVIEW_STATUSES = Object.keys(reviewStatusInfo) as ReviewStatus[];

export interface ReservationActions {
  checkIn: boolean;
  checkOut: boolean;
  noShow: boolean;
  cancel: boolean;
  /** A confirmed stay that starts later: the day check-in opens. */
  checkInOpensOn: string | null;
}

/**
 * What the front desk may do now (API_DOCUMENTATION.md §14.5). Today is the browser's date, which is the hotel's date
 * for hotels in India; the API checks again in hotel time.
 * - Check in: confirmed, from the check-in day until the check-out day.
 * - No-show: confirmed, from the day after check-in.
 * - Cancel (hotel): confirmed, until the check-in day.
 * - Check out: checked in (early is allowed).
 */
export function reservationActions(reservation: Pick<ReservationRow, 'status' | 'checkIn' | 'checkOut'>, today = todayIso()): ReservationActions {
  const confirmed = reservation.status === 'CONFIRMED';
  return {
    checkIn: confirmed && today >= reservation.checkIn && today < reservation.checkOut,
    checkOut: reservation.status === 'CHECKED_IN',
    noShow: confirmed && today > reservation.checkIn,
    cancel: confirmed && today <= reservation.checkIn,
    checkInOpensOn: confirmed && today < reservation.checkIn ? reservation.checkIn : null,
  };
}

/** The date range of a dashboard or report page, kept in the URL with the page's other parameters. */
export function useRangeParam(): [DateRangeQuery, (range: DateRangeQuery) => void] {
  const [params, setParams] = useSearchParams();
  return [readRange(params), (range) => setParams(writeRange(params, range))];
}

const percentFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const countFormat = new Intl.NumberFormat('en-IN');

/** 62.5 → "62.5%", 80 → "80%". */
export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : `${percentFormat.format(value)}%`;
}

/** 12840 → "12,840". */
export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : countFormat.format(value);
}

/** "Asha Rao" or the booking reference when the guest's name is not known. */
export function guestLabel(row: Pick<ReservationRow, 'leadGuest' | 'bookingReference'>): string {
  return row.leadGuest || row.bookingReference || 'Guest';
}
