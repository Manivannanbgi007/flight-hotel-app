import { apiClient } from '@/lib/api/client';
import { rangeQuery, type DateRange, type RangeEcho } from '../shared/dateRange';

/** Admin reports (API_DOCUMENTATION.md §14.1) and the hotel occupancy across hotels (§14.5). */

export type ColumnType = 'TEXT' | 'MONEY' | 'NUMBER' | 'DATE' | 'DATETIME' | 'PERCENT';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export type ReportRow = Record<string, unknown>;

/**
 * One page of a report; `totals` cover every row of the range and filters, not only this page. Rows may carry ids that
 * are not columns (`bookingId`, `cancellationId`, `userId`): the table uses them for links.
 */
export interface ReportResult {
  report?: string;
  title?: string;
  range: RangeEcho | null;
  columns: ReportColumn[];
  content: ReportRow[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  totals: Record<string, unknown>;
}

/** Search, filters, sorting and paging of a report (empty strings are left out). */
export type ReportQuery = {
  range: DateRange;
  q: string;
  type: string;
  status: string;
  sort: string;
  page: number;
};

export interface OccupancyRow {
  hotelId: string;
  name: string;
  city: string;
  roomNights: number;
  bookedRoomNights: number;
  occupancyPercent: number;
  revenue: number;
}

/** `GET /api/admin/hotels/occupancy` (hotel-service): every hotel for the range, with totals over all of them. */
export interface OccupancyResult {
  range: RangeEcho | null;
  hotels: OccupancyRow[];
  totals: Partial<Pick<OccupancyRow, 'roomNights' | 'bookedRoomNights' | 'occupancyPercent' | 'revenue'>> | null;
}


const filterParams = (query: Omit<ReportQuery, 'page'>) => ({
  ...rangeQuery(query.range),
  q: query.q || undefined,
  type: query.type || undefined,
  status: query.status || undefined,
  sort: query.sort || undefined,
});



export const reportApi = {
  async get(report: string, query: ReportQuery, size = 20): Promise<ReportResult> {
    const { data } = await apiClient.get<ReportResult>(`/admin/reports/${encodeURIComponent(report)}`, {
      params: { ...filterParams(query), page: query.page, size },
    });
    return data;
  },


  /** Occupancy and revenue per hotel for the range (hotel-service, ADMIN). */
  async occupancy(range: DateRange): Promise<OccupancyResult> {
    const { data } = await apiClient.get<OccupancyResult>('/admin/hotels/occupancy', { params: rangeQuery(range) });
    return data;
  },

};
