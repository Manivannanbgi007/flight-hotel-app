import { apiClient } from '@/lib/api/client';

const userPath = (userId) => `/admin/users/${encodeURIComponent(userId)}`;

export const userApi = {
  async list(filters, size = 20) {
    const { data } = await apiClient.get('/admin/users', {
      params: {
        search: filters.search || undefined,
        role: filters.role || undefined,
        status: filters.status || undefined,
        page: filters.page,
        size,
        sort: filters.sort,
      },
    });
    return data;
  },

  async get(userId) {
    const { data } = await apiClient.get(userPath(userId));
    return data;
  },

  /** `201`: the person gets a "set your password" e-mail. `409 EMAIL_ALREADY_REGISTERED` when the address is taken. */
  async invite(body) {
    const { data } = await apiClient.post('/admin/users', body);
    return data;
  },

  /** Deactivating ends every session of that user at once. `422 CANNOT_CHANGE_OWN_ACCOUNT` for yourself. */
  async changeStatus(userId, status, reason) {
    const { data } = await apiClient.patch(`${userPath(userId)}/status`, { status, reason: reason || undefined });
    return data;
  },

  /** `422 CANNOT_CHANGE_OWN_ACCOUNT` when removing your own ADMIN role, `422 UNKNOWN_ROLE`. */
  async changeRoles(userId, roles) {
    const { data } = await apiClient.put(`${userPath(userId)}/roles`, { roles });
    return data;
  },
};
