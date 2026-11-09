import { analyticsApiParams, type AnalyticsQuery } from '@/components/analytics/range';
import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';
import type {
  DateRangeQuery,
  HotelDashboard,
  ManagerReview,
  OccupancyNight,
  OccupancyReport,
  RangeEcho,
  ReservationDetails,
  ReservationFilters,
  ReservationRow,
  ReservationSummary,
  RevenueNight,
  RevenueReport,
  ReviewSortKey,
  ReviewStatus,
  ReviewSummary,
  RoomTypeReport,
} from './operationsTypes';

const hotelPath = (hotelId: string) => `/hotel-manager/hotels/${encodeURIComponent(hotelId)}`;
const reservationPath = (hotelId: string, reservationId: string) =>
  `${hotelPath(hotelId)}/reservations/${encodeURIComponent(reservationId)}`;

/** `range=…` plus `from`/`to` for CUSTOM only (§14.0). */
export function rangeParams(range: DateRangeQuery): Record<string, string> {
  return range.range === 'CUSTOM' && range.from && range.to
    ? { range: 'CUSTOM', from: range.from, to: range.to }
    : { range: range.range };
}

/** The raw report answer: "per night {…} + totals". The array's name is not fixed by the contract, so all likely names are read. */
interface RawReport<Row> {
  range?: RangeEcho | null;
  nights?: Row[];
  rows?: Row[];
  days?: Row[];
  content?: Row[];
  totals?: Record<string, number> | null;
}

const rowsOf = <Row,>(raw: RawReport<Row>): Row[] => raw.nights ?? raw.rows ?? raw.days ?? raw.content ?? [];
const sum = <Row,>(rows: Row[], pick: (row: Row) => number) => rows.reduce((total, row) => total + (pick(row) || 0), 0);
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Totals from the server; any figure it left out is worked out from the nights. */
export function normalizeOccupancy(raw: RawReport<OccupancyNight>): OccupancyReport {
  const rows = rowsOf(raw);
  const roomNights = raw.totals?.roomNights ?? sum(rows, (r) => r.roomNights);
  const bookedRoomNights = raw.totals?.bookedRoomNights ?? sum(rows, (r) => r.bookedRoomNights);
  return {
    range: raw.range ?? null,
    rows,
    totals: { roomNights, bookedRoomNights, occupancyPercent: raw.totals?.occupancyPercent ?? percent(bookedRoomNights, roomNights) },
  };
}

export function normalizeRevenue(raw: RawReport<RevenueNight>): RevenueReport {
  const rows = rowsOf(raw);
  const roomNights = raw.totals?.roomNights ?? sum(rows, (r) => r.roomNights);
  const revenue = raw.totals?.revenue ?? sum(rows, (r) => r.revenue);
  const adr = roomNights > 0 ? Math.round((revenue / roomNights) * 100) / 100 : 0;
  return { range: raw.range ?? null, rows, totals: { roomNights, revenue, averageDailyRate: raw.totals?.averageDailyRate ?? adr } };
}

/**
 * `/api/hotel-manager/hotels/{hotelId}/…` (API_DOCUMENTATION.md §14.4–14.5). Managers only reach their assigned hotels
 * (`403 HOTEL_NOT_ASSIGNED`), admins every hotel.
 */
export const operationsApi = {
  /** Dashboard v2 (api-analytics §4): any analytics range up to five years; without `interval` the server chooses. */
  async dashboard(hotelId: string, query: AnalyticsQuery): Promise<HotelDashboard> {
    const { data } = await apiClient.get<HotelDashboard>(`${hotelPath(hotelId)}/dashboard`, { params: analyticsApiParams(query) });
    return data;
  },

  /** Held, expired and released reservations are only listed when that status is asked for. */
  async reservations(hotelId: string, filters: ReservationFilters, size = 20): Promise<Page<ReservationRow>> {
    const { data } = await apiClient.get<Page<ReservationRow>>(`${hotelPath(hotelId)}/reservations`, {
      params: {
        status: filters.status || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        dateField: filters.from || filters.to ? filters.dateField : undefined,
        q: filters.q || undefined,
        roomTypeId: filters.roomTypeId || undefined,
        sort: filters.sort,
        page: filters.page,
        size,
      },
    });
    return data;
  },

  /** The counts above the list: per status, for the same dates, search words and room type. */
  async reservationSummary(hotelId: string, filters: ReservationFilters): Promise<ReservationSummary> {
    const { data } = await apiClient.get<ReservationSummary>(`${hotelPath(hotelId)}/reservations/summary`, {
      params: {
        from: filters.from || undefined,
        to: filters.to || undefined,
        dateField: filters.from || filters.to ? filters.dateField : undefined,
        q: filters.q || undefined,
        roomTypeId: filters.roomTypeId || undefined,
      },
    });
    return data;
  },

  async reservation(hotelId: string, reservationId: string): Promise<ReservationDetails> {
    const { data } = await apiClient.get<ReservationDetails>(reservationPath(hotelId, reservationId));
    return data;
  },

  /** CONFIRMED → CHECKED_IN, from the check-in day (`422 NOT_CHECK_IN_DAY`, `409 INVALID_RESERVATION_STATE`). */
  async checkIn(hotelId: string, reservationId: string): Promise<void> {
    await apiClient.post(`${reservationPath(hotelId, reservationId)}/check-in`);
  },

  /** CHECKED_IN → CHECKED_OUT (early is allowed); the booking is completed. */
  async checkOut(hotelId: string, reservationId: string): Promise<void> {
    await apiClient.post(`${reservationPath(hotelId, reservationId)}/check-out`);
  },

  /** CONFIRMED → NO_SHOW, from the day after check-in. */
  async noShow(hotelId: string, reservationId: string): Promise<void> {
    await apiClient.post(`${reservationPath(hotelId, reservationId)}/no-show`);
  },

  /** The hotel cancels a confirmed stay before check-in: the rooms go back on sale and the guest is refunded in full. */
  async cancel(hotelId: string, reservationId: string, reason: string): Promise<void> {
    await apiClient.post(`${reservationPath(hotelId, reservationId)}/cancel`, { reason });
  },

  async occupancyReport(hotelId: string, range: DateRangeQuery): Promise<OccupancyReport> {
    const { data } = await apiClient.get<RawReport<OccupancyNight>>(`${hotelPath(hotelId)}/reports/occupancy`, { params: rangeParams(range) });
    return normalizeOccupancy(data);
  },

  async revenueReport(hotelId: string, range: DateRangeQuery): Promise<RevenueReport> {
    const { data } = await apiClient.get<RawReport<RevenueNight>>(`${hotelPath(hotelId)}/reports/revenue`, { params: rangeParams(range) });
    return normalizeRevenue(data);
  },


  /** The hotel's reviews, any status (read only). */
  async reviews(
    hotelId: string,
    filters: { status: ReviewStatus | ''; page: number; rating?: number | null; sort?: ReviewSortKey },
    size = 10,
  ): Promise<Page<ManagerReview>> {
    const { data } = await apiClient.get<Page<ManagerReview>>(`${hotelPath(hotelId)}/reviews`, {
      params: {
        status: filters.status || undefined,
        rating: filters.rating || undefined,
        sort: filters.sort && filters.sort !== 'newest' ? filters.sort : undefined,
        page: filters.page,
        size,
      },
    });
    return data;
  },

  /** Average, counts per star, positive and negative reviews and the last 12 months. */
  async reviewSummary(hotelId: string): Promise<ReviewSummary> {
    const { data } = await apiClient.get<ReviewSummary>(`${hotelPath(hotelId)}/reviews/summary`);
    return data;
  },

  /** Room type performance for the range: sold room-nights, room revenue and ADR per room type. */
  async roomTypeReport(hotelId: string, range: DateRangeQuery): Promise<RoomTypeReport> {
    const { data } = await apiClient.get<RoomTypeReport>(`${hotelPath(hotelId)}/reports/room-types`, { params: rangeParams(range) });
    return data;
  },
};
