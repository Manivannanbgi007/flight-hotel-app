import { statusInfo, statusLabel } from '@/features/bookings/status';

import { formatDate, formatDateTime, formatMoney } from '@/lib/format';

/** The reports an admin can open (API_DOCUMENTATION.md §14.1 + hotel occupancy of §14.5). */

const TYPES = [
  { value: 'HOTEL', label: 'Hotels' },
  { value: 'FLIGHT', label: 'Flights' },
];

export const REPORTS = [
  {
    key: 'bookings',
    title: 'Bookings',
    description: 'Every booking created in the range, with its status, amount and refunds.',
    search: 'Reference, e-mail, title or destination',
    sorts: ['createdAt', 'totalAmount', 'travelDate'],
    type: TYPES,
    status: Object.keys(statusInfo).map((value) => ({ value, label: statusLabel(value) })),
  },
  {
    key: 'revenue',
    title: 'Revenue',
    description: 'Payments, refunds and net revenue per day.',
    search: null,
    sorts: ['date'],
  },
  {
    key: 'payments',
    title: 'Payments',
    description: 'Successful and failed payments with what was refunded.',
    search: 'Booking reference or payment id',
    sorts: ['at', 'amount'],
    status: [
      { value: 'SUCCESS', label: 'Successful' },
      { value: 'FAILED', label: 'Failed' },
    ],
  },
  {
    key: 'refunds',
    title: 'Refunds',
    description: 'Refund requests and their outcome.',
    search: 'Booking reference',
    sorts: ['requestedAt', 'amount'],
    status: [
      { value: 'REQUESTED', label: 'In progress' },
      { value: 'COMPLETED', label: 'Completed' },
      { value: 'FAILED', label: 'Failed' },
    ],
  },
  {
    key: 'cancellations',
    title: 'Cancellations',
    description: 'Cancelled bookings, who cancelled, the fee kept and the refund.',
    search: 'Reference or title',
    sorts: ['cancelledAt', 'refundAmount'],
    type: TYPES,
  },
  {
    key: 'destinations',
    title: 'Destinations',
    description: 'Paid flight and hotel bookings and revenue per city.',
    search: 'City',
    sorts: ['bookings', 'revenue'],
  },
  {
    key: 'customers',
    title: 'Customers',
    description: 'Customers with their bookings and what they spent.',
    search: 'E-mail or name',
    sorts: ['spent', 'bookings', 'registeredAt', 'lastBookingAt'],
  },
  {
    key: 'occupancy',
    title: 'Hotel occupancy',
    description: 'Room nights on sale, booked room nights, occupancy and room revenue per hotel.',
    search: 'Hotel or city',
    sorts: ['name', 'city', 'roomNights', 'bookedRoomNights', 'occupancyPercent', 'revenue'],
  },
];

export function findReport(key) {
  return REPORTS.find((report) => report.key === key);
}

const NUMERIC = ['MONEY', 'NUMBER', 'PERCENT'];
export const isNumeric = (type) => NUMERIC.includes(type);

/** A cell as text, by the column type. Empty values show as "—". */
export function formatCell(value, type) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const number = typeof value === 'number' ? value : Number(value);
  switch (type) {
    case 'MONEY':
      return Number.isFinite(number) ? formatMoney(number, 'INR', true) : String(value);
    case 'NUMBER':
      return Number.isFinite(number) ? number.toLocaleString('en-IN') : String(value);
    case 'PERCENT':
      return Number.isFinite(number) ? `${number.toFixed(1)}%` : String(value);
    case 'DATE':
      return typeof value === 'string' ? formatDate(value.slice(0, 10)) : String(value);
    case 'DATETIME':
      return typeof value === 'string' ? formatDateTime(value) : String(value);
    default:
      return String(value);
  }
}

/** Words for a total that has no column of its own (`count`, `customers`). */
export function totalLabel(key) {
  if (key === 'count') return 'Rows';
  if (key === 'customers') return 'Customers';
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (first) => first.toUpperCase());
}

// ---- Hotel occupancy: a plain list from hotel-service, shown like the other reports (search, sort and pages here) ----

export const OCCUPANCY_COLUMNS = [
  { key: 'name', label: 'Hotel', type: 'TEXT' },
  { key: 'city', label: 'City', type: 'TEXT' },
  { key: 'roomNights', label: 'Room nights', type: 'NUMBER' },
  { key: 'bookedRoomNights', label: 'Booked room nights', type: 'NUMBER' },
  { key: 'occupancyPercent', label: 'Occupancy', type: 'PERCENT' },
  { key: 'revenue', label: 'Revenue', type: 'MONEY' },
];

/**
 * The occupancy answer as a report page. The search, sorting and pages happen here (hotel-service sends every hotel);
 * the server's totals are used unless a search narrows the hotels, then they are added up for the matching ones.
 */
export function occupancyReport(result, { q, sort, page, size = 20 }) {
  const rows = result.hotels;
  const needle = q.trim().toLowerCase();
  const matching = needle
    ? rows.filter((row) => row.name.toLowerCase().includes(needle) || row.city.toLowerCase().includes(needle))
    : rows;
  const [field, direction] = sort.split(',');
  const sorted = field
    ? [...matching].sort((a, b) => {
        const left = a[field];
        const right = b[field];
        const order =
          typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right));
        return direction === 'asc' ? order : -order;
      })
    : matching;
  const roomNights = matching.reduce((sum, row) => sum + row.roomNights, 0);
  const bookedRoomNights = matching.reduce((sum, row) => sum + row.bookedRoomNights, 0);
  const added = {
    roomNights,
    bookedRoomNights,
    occupancyPercent: roomNights > 0 ? (bookedRoomNights / roomNights) * 100 : 0,
    revenue: matching.reduce((sum, row) => sum + row.revenue, 0),
  };
  const totalPages = Math.ceil(sorted.length / size);
  return {
    range: result.range,
    columns: OCCUPANCY_COLUMNS,
    content: sorted.slice(page * size, page * size + size),
    page,
    size,
    totalElements: sorted.length,
    totalPages,
    totals: !needle && result.totals ? { ...added, ...result.totals } : added,
  };
}

/** Where a cell links to: references open the booking, payment ids the payment, e-mails of customers the user. */
export function cellLink(columnKey, row) {
  const id = (key) => (typeof row[key] === 'string' && row[key] ? row[key] : null);
  if ((columnKey === 'reference' || columnKey === 'bookingReference') && id('bookingId'))
    return `/admin/bookings/${id('bookingId')}`;
  if (columnKey === 'paymentId' && id('paymentId')) return `/admin/payments/${id('paymentId')}`;
  if (columnKey === 'email' && id('userId')) return `/admin/users/${id('userId')}`;
  return null;
}
