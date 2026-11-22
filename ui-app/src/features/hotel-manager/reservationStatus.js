import { useSearchParams } from 'react-router';

import { todayIso } from '@/features/account/schemas';
import { readRange, writeRange } from './dateRange';

/** How each reservation status reads for the hotel. */
export const reservationStatusInfo = {
  HELD: { label: 'Held, not paid yet', tone: 'neutral' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  CHECKED_IN: { label: 'Checked in', tone: 'info' },
  CHECKED_OUT: { label: 'Checked out', tone: 'neutral' },
  NO_SHOW: { label: 'No-show', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  RELEASED: { label: 'Released', tone: 'neutral' },
};

export const RESERVATION_STATUSES = Object.keys(reservationStatusInfo);

export const reviewStatusInfo = {
  PENDING: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Published', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

export const REVIEW_STATUSES = Object.keys(reviewStatusInfo);

/**
 * What the front desk may do now (API_DOCUMENTATION.md §14.5). Today is the browser's date, which is the hotel's date
 * for hotels in India; the API checks again in hotel time.
 * - Check in: confirmed, from the check-in day until the check-out day.
 * - No-show: confirmed, from the day after check-in.
 * - Cancel (hotel): confirmed, until the check-in day.
 * - Check out: checked in (early is allowed).
 */
export function reservationActions(reservation, today = todayIso()) {
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
export function useRangeParam() {
  const [params, setParams] = useSearchParams();
  return [readRange(params), (range) => setParams(writeRange(params, range))];
}

const percentFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const countFormat = new Intl.NumberFormat('en-IN');

/** 62.5 → "62.5%", 80 → "80%". */
export function formatPercent(value) {
  return value === null || value === undefined ? '' : `${percentFormat.format(value)}%`;
}

/** 12840 → "12,840". */
export function formatCount(value) {
  return value === null || value === undefined ? '' : countFormat.format(value);
}

/** "Asha Rao" or the booking reference when the guest's name is not known. */
export function guestLabel(row) {
  return row.leadGuest || row.bookingReference || 'Guest';
}
