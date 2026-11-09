import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';
import type {
  HotelProfile,
  HotelStatus,
  HotelSummary,
  ImageItem,
  InventoryCalendar,
  ManagerItem,
  RatePlanItem,
  RatePlanRequest,
  RoomTypeItem,
  RoomTypeRequest,
  SeasonalRateItem,
  SeasonalRateRequest,
  UpdateHotelProfileRequest,
  UpdateInventoryRequest,
} from './types';

const hotelPath = (hotelId: string) => `/hotel-manager/hotels/${encodeURIComponent(hotelId)}`;
const roomPath = (hotelId: string, roomTypeId: string) => `${hotelPath(hotelId)}/room-types/${encodeURIComponent(roomTypeId)}`;
const planPath = (hotelId: string, roomTypeId: string, planId: string) =>
  `${roomPath(hotelId, roomTypeId)}/rate-plans/${encodeURIComponent(planId)}`;

/** `/api/hotel-manager` (managers: assigned hotels; admins: all hotels). */
export const managerApi = {
  async myHotels(): Promise<HotelSummary[]> {
    const { data } = await apiClient.get<HotelSummary[]>('/hotel-manager/hotels');
    return data;
  },
  async profile(hotelId: string): Promise<HotelProfile> {
    const { data } = await apiClient.get<HotelProfile>(hotelPath(hotelId));
    return data;
  },
  async updateProfile(hotelId: string, body: UpdateHotelProfileRequest): Promise<HotelProfile> {
    const { data } = await apiClient.put<HotelProfile>(hotelPath(hotelId), body);
    return data;
  },
  /** `onProgress` gets the share of the file sent so far (0 to 100). */
  async uploadImage(hotelId: string, file: File, caption?: string, roomTypeId?: string, onProgress?: (percent: number) => void): Promise<ImageItem> {
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('caption', caption);
    if (roomTypeId) form.append('roomTypeId', roomTypeId);
    const { data } = await apiClient.post<ImageItem>(`${hotelPath(hotelId)}/images`, form, {
      onUploadProgress: onProgress
        ? (event) => onProgress(event.total ? Math.min(100, Math.round((event.loaded / event.total) * 100)) : 0)
        : undefined,
    });
    return data;
  },
  async updateImage(hotelId: string, imageId: string, body: { caption?: string; cover?: boolean; sortOrder?: number;
    roomTypeId?: string; clearRoomType?: boolean }): Promise<ImageItem> {
    const { data } = await apiClient.patch<ImageItem>(`${hotelPath(hotelId)}/images/${encodeURIComponent(imageId)}`, body);
    return data;
  },
  async deleteImage(hotelId: string, imageId: string): Promise<void> {
    await apiClient.delete(`${hotelPath(hotelId)}/images/${encodeURIComponent(imageId)}`);
  },
  async roomTypes(hotelId: string): Promise<RoomTypeItem[]> {
    const { data } = await apiClient.get<RoomTypeItem[]>(`${hotelPath(hotelId)}/room-types`);
    return data;
  },
  async createRoomType(hotelId: string, body: RoomTypeRequest): Promise<RoomTypeItem> {
    const { data } = await apiClient.post<RoomTypeItem>(`${hotelPath(hotelId)}/room-types`, body);
    return data;
  },
  async updateRoomType(hotelId: string, roomTypeId: string, body: RoomTypeRequest): Promise<RoomTypeItem> {
    const { data } = await apiClient.put<RoomTypeItem>(roomPath(hotelId, roomTypeId), body);
    return data;
  },
  async createRatePlan(hotelId: string, roomTypeId: string, body: RatePlanRequest): Promise<RatePlanItem> {
    const { data } = await apiClient.post<RatePlanItem>(`${roomPath(hotelId, roomTypeId)}/rate-plans`, body);
    return data;
  },
  async updateRatePlan(hotelId: string, roomTypeId: string, planId: string, body: RatePlanRequest): Promise<RatePlanItem> {
    const { data } = await apiClient.put<RatePlanItem>(planPath(hotelId, roomTypeId, planId), body);
    return data;
  },
  async addSeasonalRate(hotelId: string, roomTypeId: string, planId: string, body: SeasonalRateRequest): Promise<SeasonalRateItem> {
    const { data } = await apiClient.post<SeasonalRateItem>(`${planPath(hotelId, roomTypeId, planId)}/seasonal-rates`, body);
    return data;
  },
  async deleteSeasonalRate(hotelId: string, roomTypeId: string, planId: string, rateId: string): Promise<void> {
    await apiClient.delete(`${planPath(hotelId, roomTypeId, planId)}/seasonal-rates/${encodeURIComponent(rateId)}`);
  },
  async inventory(hotelId: string, from: string, to: string): Promise<InventoryCalendar> {
    const { data } = await apiClient.get<InventoryCalendar>(`${hotelPath(hotelId)}/inventory`, { params: { from, to } });
    return data;
  },
  async updateInventory(hotelId: string, body: UpdateInventoryRequest): Promise<InventoryCalendar> {
    const { data } = await apiClient.put<InventoryCalendar>(`${hotelPath(hotelId)}/inventory`, body);
    return data;
  },
};

/** `/api/admin/hotels` (role ADMIN). */
export const adminHotelApi = {
  async list(query: { search?: string; status?: HotelStatus; page: number }, size = 20): Promise<Page<HotelSummary>> {
    const { data } = await apiClient.get<Page<HotelSummary>>('/admin/hotels', {
      params: { search: query.search || undefined, status: query.status || undefined, page: query.page, size },
    });
    return data;
  },
  async create(body: { name: string; propertyType: string; addressLine: string; city: string; countryCode: string;
    starRating?: number }): Promise<HotelSummary> {
    const { data } = await apiClient.post<HotelSummary>('/admin/hotels', body);
    return data;
  },
  async changeStatus(hotelId: string, status: HotelStatus): Promise<HotelSummary> {
    const { data } = await apiClient.patch<HotelSummary>(`/admin/hotels/${encodeURIComponent(hotelId)}/status`, { status });
    return data;
  },
  async managers(hotelId: string): Promise<ManagerItem[]> {
    const { data } = await apiClient.get<ManagerItem[]>(`/admin/hotels/${encodeURIComponent(hotelId)}/managers`);
    return data;
  },
  async assignManager(hotelId: string, email: string): Promise<ManagerItem[]> {
    const { data } = await apiClient.post<ManagerItem[]>(`/admin/hotels/${encodeURIComponent(hotelId)}/managers`, { email });
    return data;
  },
  async unassignManager(hotelId: string, userId: string): Promise<ManagerItem[]> {
    const { data } = await apiClient.delete<ManagerItem[]>(
      `/admin/hotels/${encodeURIComponent(hotelId)}/managers/${encodeURIComponent(userId)}`);
    return data;
  },
};
