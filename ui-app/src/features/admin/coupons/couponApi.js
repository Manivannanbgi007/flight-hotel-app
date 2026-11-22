import { apiClient } from '@/lib/api/client';

/** `/api/admin/coupons` and `/api/admin/offers` (API_DOCUMENTATION.md §14.2, permission COUPON_MANAGE). */

const couponPath = (id) => `/admin/coupons/${encodeURIComponent(id)}`;
const offerPath = (id) => `/admin/offers/${encodeURIComponent(id)}`;

export const couponApi = {
  async list(filters, size = 20) {
    const { data } = await apiClient.get('/admin/coupons', {
      params: { q: filters.q || undefined, status: filters.status || undefined, page: filters.page, size },
    });
    return data;
  },
  /** `409 COUPON_CODE_TAKEN`. */
  async create(body) {
    const { data } = await apiClient.post('/admin/coupons', body);
    return data;
  },
  /** The code cannot change; the usage limit cannot go below what is already used (`422 USAGE_LIMIT_TOO_LOW`). */
  async update(id, body) {
    const { data } = await apiClient.put(couponPath(id), body);
    return data;
  },
  async setStatus(id, status) {
    const { data } = await apiClient.patch(`${couponPath(id)}/status`, { status });
    return data;
  },
};

export const offerApi = {
  async list(filters, size = 20) {
    const { data } = await apiClient.get('/admin/offers', {
      params: { q: filters.q || undefined, status: filters.status || undefined, page: filters.page, size },
    });
    return data;
  },
  async create(body) {
    const { data } = await apiClient.post('/admin/offers', body);
    return data;
  },
  async update(id, body) {
    const { data } = await apiClient.put(offerPath(id), body);
    return data;
  },
  async setStatus(id, status) {
    const { data } = await apiClient.patch(`${offerPath(id)}/status`, { status });
    return data;
  },
};
