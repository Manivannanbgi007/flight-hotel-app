import { apiClient } from '@/lib/api/client';

/** `/api/notifications`: the bell, the Notification Center and the notification settings. */
export const notificationApi = {
  /** The bell: the latest notifications. */
  async list(size = 10) {
    const { data } = await apiClient.get('/notifications', { params: { page: 0, size } });
    return data;
  },

  /** The Notification Center: one page, newest first. */
  async search(filters, size = 20) {
    const { data } = await apiClient.get('/notifications', {
      params: { unreadOnly: filters.unreadOnly, category: filters.category || undefined, page: filters.page, size },
    });
    return data;
  },

  async unreadCount() {
    const { data } = await apiClient.get('/notifications/unread-count');
    return data.count;
  },

  async markRead(id) {
    await apiClient.post(`/notifications/${encodeURIComponent(id)}/read`);
  },

  async markUnread(id) {
    await apiClient.post(`/notifications/${encodeURIComponent(id)}/unread`);
  },

  /** Returns how many notifications were marked read. */
  async markAllRead() {
    const { data } = await apiClient.post('/notifications/read-all');
    return typeof data === 'object' && data !== null ? (data.updated ?? 0) : 0;
  },

  async getPreferences() {
    const { data } = await apiClient.get('/notifications/preferences');
    return data;
  },

  async updatePreferences(body) {
    const { data } = await apiClient.put('/notifications/preferences', body);
    return data;
  },
};
