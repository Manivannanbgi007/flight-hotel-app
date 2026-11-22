import { apiClient } from '@/lib/api/client';

/** `/api/customers` endpoints (API_DOCUMENTATION.md §3): the logged-in user's own account. */
export const accountApi = {
  async getProfile() {
    const { data } = await apiClient.get('/customers/profile');
    return data;
  },

  async updateProfile(body) {
    const { data } = await apiClient.put('/customers/profile', body);
    return data;
  },

  async uploadPhoto(file) {
    const form = new FormData();
    form.append('file', file);
    const { data } = await apiClient.put('/customers/profile/photo', form);
    return data;
  },

  /** The photo is only served with the owner's token, so it is loaded as a blob (never a public URL). */
  async getPhoto() {
    // The client's default "Accept: application/json" would get 406 from an image endpoint.
    const { data } = await apiClient.get('/customers/profile/photo', {
      responseType: 'blob',
      headers: { Accept: 'image/jpeg' },
    });
    return data;
  },

  async deletePhoto() {
    await apiClient.delete('/customers/profile/photo');
  },

  async listPassengers() {
    const { data } = await apiClient.get('/customers/passengers');
    return data;
  },

  async createPassenger(body) {
    const { data } = await apiClient.post('/customers/passengers', body);
    return data;
  },

  async updatePassenger(id, body) {
    const { data } = await apiClient.put(`/customers/passengers/${encodeURIComponent(id)}`, body);
    return data;
  },

  async deletePassenger(id) {
    await apiClient.delete(`/customers/passengers/${encodeURIComponent(id)}`);
  },

  async getPreferences() {
    const { data } = await apiClient.get('/customers/preferences');
    return data;
  },

  async updatePreferences(body) {
    const { data } = await apiClient.put('/customers/preferences', body);
    return data;
  },

  /** Returns a fresh access token for this session; every other session is logged out. */
  async changePassword(body) {
    const { data } = await apiClient.post('/customers/security/change-password', body);
    return data;
  },

  async logoutEverywhere() {
    await apiClient.post('/customers/security/logout-all');
  },

  async loginHistory(page, size = 10) {
    const { data } = await apiClient.get('/customers/security/login-history', {
      params: { page, size },
    });
    return data;
  },
};
