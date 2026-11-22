import { analyticsApiParams } from '@/components/analytics/range';
import { apiClient } from '@/lib/api/client';

const hotelPath = (hotelId) => `/hotel-manager/hotels/${encodeURIComponent(hotelId)}`;
const reservationPath = (hotelId, reservationId) =>
  `${hotelPath(hotelId)}/reservations/${encodeURIComponent(reservationId)}`;

/** `range=…` plus `from`/`to` for CUSTOM only (§14.0). */
export function rangeParams(range) {
  return range.range === 'CUSTOM' && range.from && range.to
    ? { range: 'CUSTOM', from: range.from, to: range.to }
    : { range: range.range };
}

const rowsOf = (raw) => raw.nights ?? raw.rows ?? raw.days ?? raw.content ?? [];
const sum = (rows, pick) => rows.reduce((total, row) => total + (pick(row) || 0), 0);
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Totals from the server; any figure it left out is worked out from the nights. */
export function normalizeOccupancy(raw) {
  const rows = rowsOf(raw);
  const roomNights = raw.totals?.roomNights ?? sum(rows, (r) => r.roomNights);
  const bookedRoomNights = raw.totals?.bookedRoomNights ?? sum(rows, (r) => r.bookedRoomNights);
  return {
    range: raw.range ?? null,
    rows,
    totals: {
      roomNights,
      bookedRoomNights,
      occupancyPercent: raw.totals?.occupancyPercent ?? percent(bookedRoomNights, roomNights),
    },
  };
}

export function normalizeRevenue(raw) {
  const rows = rowsOf(raw);
  const roomNights = raw.totals?.roomNights ?? sum(rows, (r) => r.roomNights);
  const revenue = raw.totals?.revenue ?? sum(rows, (r) => r.revenue);
  const adr = roomNights > 0 ? Math.round((revenue / roomNights) * 100) / 100 : 0;
  return {
    range: raw.range ?? null,
    rows,
    totals: { roomNights, revenue, averageDailyRate: raw.totals?.averageDailyRate ?? adr },
  };
}

/**
 * `/api/hotel-manager/hotels/{hotelId}/…` (API_DOCUMENTATION.md §14.4–14.5). Managers only reach their assigned hotels
 * (`403 HOTEL_NOT_ASSIGNED`), admins every hotel.
 */
export const operationsApi = {
  /** Dashboard v2 (api-analytics §4): any analytics range up to five years; without `interval` the server chooses. */
  async dashboard(hotelId, query) {
    const { data } = await apiClient.get(`${hotelPath(hotelId)}/dashboard`, { params: analyticsApiParams(query) });
    return data;
  },

  /** Held, expired and released reservations are only listed when that status is asked for. */
  async reservations(hotelId, filters, size = 20) {
    const { data } = await apiClient.get(`${hotelPath(hotelId)}/reservations`, {
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
  async reservationSummary(hotelId, filters) {
    const { data } = await apiClient.get(`${hotelPath(hotelId)}/reservations/summary`, {
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

  async reservation(hotelId, reservationId) {
    const { data } = await apiClient.get(reservationPath(hotelId, reservationId));
    return data;
  },

  /** CONFIRMED → CHECKED_IN, from the check-in day (`422 NOT_CHECK_IN_DAY`, `409 INVALID_RESERVATION_STATE`). */
  async checkIn(hotelId, reservationId) {
    await apiClient.post(`${reservationPath(hotelId, reservationId)}/check-in`);
  },

  /** CHECKED_IN → CHECKED_OUT (early is allowed); the booking is completed. */
  async checkOut(hotelId, reservationId) {
    await apiClient.post(`${reservationPath(hotelId, reservationId)}/check-out`);
  },

  /** CONFIRMED → NO_SHOW, from the day after check-in. */
  async noShow(hotelId, reservationId) {
    await apiClient.post(`${reservationPath(hotelId, reservationId)}/no-show`);
  },

  /** The hotel cancels a confirmed stay before check-in: the rooms go back on sale and the guest is refunded in full. */
  async cancel(hotelId, reservationId, reason) {
    await apiClient.post(`${reservationPath(hotelId, reservationId)}/cancel`, { reason });
  },

  async occupancyReport(hotelId, range) {
    const { data } = await apiClient.get(`${hotelPath(hotelId)}/reports/occupancy`, { params: rangeParams(range) });
    return normalizeOccupancy(data);
  },

  async revenueReport(hotelId, range) {
    const { data } = await apiClient.get(`${hotelPath(hotelId)}/reports/revenue`, { params: rangeParams(range) });
    return normalizeRevenue(data);
  },

  /** The hotel's reviews, any status (read only). */
  async reviews(hotelId, filters, size = 10) {
    const { data } = await apiClient.get(`${hotelPath(hotelId)}/reviews`, {
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
  async reviewSummary(hotelId) {
    const { data } = await apiClient.get(`${hotelPath(hotelId)}/reviews/summary`);
    return data;
  },

  /** Room type performance for the range: sold room-nights, room revenue and ADR per room type. */
  async roomTypeReport(hotelId, range) {
    const { data } = await apiClient.get(`${hotelPath(hotelId)}/reports/room-types`, { params: rangeParams(range) });
    return data;
  },
};
