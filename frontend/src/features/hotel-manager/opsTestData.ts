import { addDays, format } from 'date-fns';

import type {
  HotelDashboard, HotelTrendPoint, ManagerReview, OccupancyReport, ReservationDetails, ReservationRow, ReservationSummary,
  RevenueReport, ReviewSummary, RoomTypeReport,
} from './operationsTypes';

/** Test fixtures for the hotel manager operations pages. */

/** Today + `offset` days as `YYYY-MM-DD` (the browser's date, like the pages use). */
export const day = (offset: number): string => format(addDays(new Date(), offset), 'yyyy-MM-dd');

export const reservationRow = (overrides: Partial<ReservationRow> = {}): ReservationRow => ({
  reservationId: 'r1',
  bookingId: 'b1',
  bookingReference: 'HT-7K3M9Q2X',
  status: 'CONFIRMED',
  checkIn: '2099-03-10',
  checkOut: '2099-03-12',
  nights: 2,
  rooms: 1,
  adults: 2,
  children: 0,
  roomTypeName: 'Deluxe Sea View',
  ratePlanName: 'Flexible with breakfast',
  leadGuest: 'Asha Rao',
  totalAmount: 2625,
  confirmationNumber: 'SBR-10293',
  createdAt: '2099-03-01T10:00:00Z',
  ...overrides,
});

export const reservationDetails = (overrides: Partial<ReservationDetails> = {}): ReservationDetails => ({
  ...reservationRow(),
  guests: [
    { roomNo: 1, firstName: 'Asha', lastName: 'Rao' },
    { roomNo: 1, firstName: 'Ravi', lastName: 'Rao' },
  ],
  contactEmail: 'asha@example.com',
  contactPhone: '+919876543210',
  specialRequests: 'Late arrival, around 22:00.',
  checkedInAt: null,
  checkedOutAt: null,
  cancelledAt: null,
  cancellationReference: null,
  cancelledBy: null,
  ...overrides,
});

const trendPoint = (key: string, overrides: Partial<HotelTrendPoint> = {}): HotelTrendPoint => ({
  key, start: key, end: key, availableRoomNights: 60, bookedRoomNights: 0, occupancyPercent: 0, soldRoomNights: 0, revenue: 0,
  averageDailyRate: 0, revPar: 0, reservations: 0, cancellations: 0, newReviews: 0, averageRating: null, guestRating: 4.2, reviewCount: 120,
  ...overrides,
});

/** Dashboard v2 (api-analytics §4). */
export const dashboardFixture = (overrides: Partial<HotelDashboard> = {}): HotelDashboard => ({
  range: { preset: 'LAST_30_DAYS', from: '2026-10-07', to: '2026-11-05' },
  previousRange: { preset: 'PREVIOUS_PERIOD', from: '2026-09-07', to: '2026-10-06' },
  interval: 'DAY',
  hotelId: 'h1',
  hotelName: 'Sea Breeze Resort',
  today: {
    date: '2026-11-05', arrivals: 3, departures: 2, inHouse: 11, occupancyPercent: 72.5,
    arrivingGuests: 7, departingGuests: 4, inHouseGuests: 23, inHouseRooms: 12,
    totalRooms: 45, roomsForSale: 40, roomsBooked: 29,
  },
  upcomingArrivals: [reservationRow()],
  stats: {
    reservations: 40, roomNights: 96, revenue: 512340, cancellations: 3, occupancyPercent: 64, averageDailyRate: 5336.88,
    availableRoomNights: 150, bookedRoomNights: 96, revPar: 3415.6,
  },
  cancellations: { count: 3, byCustomer: 2, byHotel: 1, ofBooked: 2, rate: 5 },
  ratings: { guestRating: 4.2, reviewCount: 120, newReviews: 4, averageNewRating: 4.5, pendingReviews: 2 },
  comparison: {
    revenue: { current: 512340, previous: 409872, change: 102468, changePercent: 25, trend: 'UP' },
    occupancyPercent: { current: 64, previous: 66.5, change: -2.5, changePercent: -3.8, trend: 'DOWN' },
    averageDailyRate: { current: 5336.88, previous: 5336.88, change: 0, changePercent: 0, trend: 'FLAT' },
    revPar: { current: 3415.6, previous: 0, change: 3415.6, changePercent: null, trend: 'UP' },
    soldRoomNights: { current: 96, previous: 80, change: 16, changePercent: 20, trend: 'UP' },
    reservations: { current: 40, previous: 32, change: 8, changePercent: 25, trend: 'UP' },
    cancellations: { current: 3, previous: 6, change: -3, changePercent: -50, trend: 'DOWN' },
    newReviews: { current: 4, previous: 0, change: 4, changePercent: null, trend: 'UP' },
  },
  trend: [
    trendPoint('2026-11-04', { bookedRoomNights: 30, occupancyPercent: 50, soldRoomNights: 30, revenue: 150000, averageDailyRate: 5000, revPar: 2500, reservations: 3 }),
    trendPoint('2026-11-05', { bookedRoomNights: 45, occupancyPercent: 75, soldRoomNights: 45, revenue: 247500, averageDailyRate: 5500, revPar: 4125, reservations: 2, cancellations: 1, newReviews: 1, averageRating: 5 }),
  ],
  ...overrides,
});

export const occupancyFixture = (overrides: Partial<OccupancyReport> = {}): OccupancyReport => ({
  range: { preset: 'LAST_7_DAYS', from: '2026-10-30', to: '2026-10-31' },
  rows: [
    { date: '2026-10-30', roomNights: 20, bookedRoomNights: 15, occupancyPercent: 75 },
    { date: '2026-10-31', roomNights: 20, bookedRoomNights: 19, occupancyPercent: 95 },
  ],
  totals: { roomNights: 40, bookedRoomNights: 34, occupancyPercent: 85 },
  ...overrides,
});

export const revenueFixture = (overrides: Partial<RevenueReport> = {}): RevenueReport => ({
  range: { preset: 'LAST_7_DAYS', from: '2026-10-30', to: '2026-10-31' },
  rows: [
    { date: '2026-10-30', roomNights: 15, revenue: 75000, averageDailyRate: 5000 },
    { date: '2026-10-31', roomNights: 19, revenue: 104500, averageDailyRate: 5500 },
  ],
  totals: { roomNights: 34, revenue: 179500, averageDailyRate: 5279.41 },
  ...overrides,
});

export const reviewFixture = (overrides: Partial<ManagerReview> = {}): ManagerReview => ({
  id: 'rv1',
  rating: 4,
  title: 'Lovely stay by the beach',
  text: 'Friendly staff and a great breakfast. The room was a bit small.',
  authorName: 'Asha R.',
  status: 'APPROVED',
  createdAt: '2026-10-20T10:00:00Z',
  stayedIn: 'Oct 2026',
  bookingReference: 'HT-7K3M9Q2X',
  rejectionReason: null,
  ...overrides,
});

export const reservationSummaryFixture = (overrides: Partial<ReservationSummary> = {}): ReservationSummary => ({
  total: 40, confirmed: 12, pending: 3, checkedIn: 5, checkedOut: 18, cancelled: 4, noShow: 1, ...overrides,
});

export const reviewSummaryFixture = (overrides: Partial<ReviewSummary> = {}): ReviewSummary => ({
  average: 4.4,
  total: 10,
  fiveStar: 6,
  positive: 8,
  negative: 1,
  pending: 2,
  distribution: { '1': 0, '2': 1, '3': 1, '4': 2, '5': 6 },
  months: [
    { month: '2026-09', reviews: 4, average: 4.5, positive: 3, negative: 0 },
    { month: '2026-10', reviews: 6, average: 4.3, positive: 5, negative: 1 },
  ],
  ...overrides,
});

export const roomTypeReportFixture = (overrides: Partial<RoomTypeReport> = {}): RoomTypeReport => ({
  range: { preset: 'LAST_30_DAYS', from: '2026-10-02', to: '2026-10-31' },
  currency: 'INR',
  rows: [
    { roomTypeId: 'rt1', name: 'Deluxe Sea View', stays: 8, roomNights: 20, revenue: 100000, averageDailyRate: 5000, revenueShare: 80 },
    { roomTypeId: 'rt2', name: 'Garden Room', stays: 4, roomNights: 10, revenue: 25000, averageDailyRate: 2500, revenueShare: 20 },
  ],
  roomNights: 30,
  revenue: 125000,
  ...overrides,
});

export const pageOf = <T>(content: T[], totalPages = 1) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages });
