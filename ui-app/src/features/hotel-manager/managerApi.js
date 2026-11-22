import { apiClient } from '@/lib/api/client';

const hotelPath = (hotelId) => `/hotel-manager/hotels/${encodeURIComponent(hotelId)}`;
const roomPath = (hotelId, roomTypeId) => `${hotelPath(hotelId)}/room-types/${encodeURIComponent(roomTypeId)}`;
const planPath = (hotelId, roomTypeId, planId) =>
  `${roomPath(hotelId, roomTypeId)}/rate-plans/${encodeURIComponent(planId)}`;

/** `/api/hotel-manager` (managers: assigned hotels; admins: all hotels). */
export const managerApi = {
  async myHotels() {
    const { data } = await apiClient.get('/hotel-manager/hotels');
    return data;
  },
  async profile(hotelId) {
    const { data } = await apiClient.get(hotelPath(hotelId));
    return data;
  },
  async updateProfile(hotelId, body) {
    const { data } = await apiClient.put(hotelPath(hotelId), body);
    return data;
  },
  /** `onProgress` gets the share of the file sent so far (0 to 100). */
  async uploadImage(hotelId, file, caption, roomTypeId, onProgress) {
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('caption', caption);
    if (roomTypeId) form.append('roomTypeId', roomTypeId);
    const { data } = await apiClient.post(`${hotelPath(hotelId)}/images`, form, {
      onUploadProgress: onProgress
        ? (event) => onProgress(event.total ? Math.min(100, Math.round((event.loaded / event.total) * 100)) : 0)
        : undefined,
    });
    return data;
  },
  async updateImage(hotelId, imageId, body) {
    const { data } = await apiClient.patch(`${hotelPath(hotelId)}/images/${encodeURIComponent(imageId)}`, body);
    return data;
  },
  async deleteImage(hotelId, imageId) {
    await apiClient.delete(`${hotelPath(hotelId)}/images/${encodeURIComponent(imageId)}`);
  },
  async roomTypes(hotelId) {
    const { data } = await apiClient.get(`${hotelPath(hotelId)}/room-types`);
    return data;
  },
  async createRoomType(hotelId, body) {
    const { data } = await apiClient.post(`${hotelPath(hotelId)}/room-types`, body);
    return data;
  },
  async updateRoomType(hotelId, roomTypeId, body) {
    const { data } = await apiClient.put(roomPath(hotelId, roomTypeId), body);
    return data;
  },
  async createRatePlan(hotelId, roomTypeId, body) {
    const { data } = await apiClient.post(`${roomPath(hotelId, roomTypeId)}/rate-plans`, body);
    return data;
  },
  async updateRatePlan(hotelId, roomTypeId, planId, body) {
    const { data } = await apiClient.put(planPath(hotelId, roomTypeId, planId), body);
    return data;
  },
  async addSeasonalRate(hotelId, roomTypeId, planId, body) {
    const { data } = await apiClient.post(`${planPath(hotelId, roomTypeId, planId)}/seasonal-rates`, body);
    return data;
  },
  async deleteSeasonalRate(hotelId, roomTypeId, planId, rateId) {
    await apiClient.delete(`${planPath(hotelId, roomTypeId, planId)}/seasonal-rates/${encodeURIComponent(rateId)}`);
  },
  async inventory(hotelId, from, to) {
    const { data } = await apiClient.get(`${hotelPath(hotelId)}/inventory`, { params: { from, to } });
    return data;
  },
  async updateInventory(hotelId, body) {
    const { data } = await apiClient.put(`${hotelPath(hotelId)}/inventory`, body);
    return data;
  },
};

/** `/api/admin/hotels` (role ADMIN). */
export const adminHotelApi = {
  async list(query, size = 20) {
    const { data } = await apiClient.get('/admin/hotels', {
      params: { search: query.search || undefined, status: query.status || undefined, page: query.page, size },
    });
    return data;
  },
  async create(body) {
    const { data } = await apiClient.post('/admin/hotels', body);
    return data;
  },
  async changeStatus(hotelId, status) {
    const { data } = await apiClient.patch(`/admin/hotels/${encodeURIComponent(hotelId)}/status`, { status });
    return data;
  },
  async managers(hotelId) {
    const { data } = await apiClient.get(`/admin/hotels/${encodeURIComponent(hotelId)}/managers`);
    return data;
  },
  async assignManager(hotelId, email) {
    const { data } = await apiClient.post(`/admin/hotels/${encodeURIComponent(hotelId)}/managers`, { email });
    return data;
  },
  async unassignManager(hotelId, userId) {
    const { data } = await apiClient.delete(
      `/admin/hotels/${encodeURIComponent(hotelId)}/managers/${encodeURIComponent(userId)}`,
    );
    return data;
  },
};
