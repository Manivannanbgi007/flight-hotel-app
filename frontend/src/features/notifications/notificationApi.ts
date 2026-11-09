import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';

/** API_DOCUMENTATION.md §10. `ACCOUNT` messages (welcome, password, security) cannot be switched off. */
export type NotificationCategory = 'ACCOUNT' | 'BOOKING' | 'PAYMENT' | 'REFUND' | 'REMINDER' | 'SUPPORT';
export type NotificationChannel = 'EMAIL' | 'IN_APP';

export interface AppNotification {
  id: string;
  /** One of NotificationCategory; kept open so a new category from the server still shows. */
  category: string;
  title: string;
  message: string;
  /** A path inside this app, e.g. `/my-trips/<id>`. */
  link: string | null;
  read: boolean;
  createdAt: string;
}

/** Notification Center filters, as kept in the URL. `category: ''` = every category. */
export interface NotificationFilters {
  unreadOnly: boolean;
  category: NotificationCategory | '';
  page: number;
}

export interface NotificationPreference {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
  /** Always sent (e.g. booking, payment and refund e-mails): shown on and cannot be switched off. */
  locked: boolean;
}

export type NewsletterStatus = 'NONE' | 'PENDING' | 'SUBSCRIBED' | 'UNSUBSCRIBED';

export interface NotificationPreferences {
  items: NotificationPreference[];
  /** The newsletter subscription of the account's e-mail address (§10d). */
  newsletter: { subscribed: boolean; status: NewsletterStatus };
}

/** Only the items sent change; `newsletter: true` subscribes the account e-mail at once, `false` unsubscribes it. */
export interface UpdatePreferencesBody {
  items: { category: NotificationCategory; channel: NotificationChannel; enabled: boolean }[];
  newsletter?: boolean;
}

/** `/api/notifications`: the bell, the Notification Center and the notification settings. */
export const notificationApi = {
  /** The bell: the latest notifications. */
  async list(size = 10): Promise<Page<AppNotification>> {
    const { data } = await apiClient.get<Page<AppNotification>>('/notifications', { params: { page: 0, size } });
    return data;
  },

  /** The Notification Center: one page, newest first. */
  async search(filters: NotificationFilters, size = 20): Promise<Page<AppNotification>> {
    const { data } = await apiClient.get<Page<AppNotification>>('/notifications', {
      params: { unreadOnly: filters.unreadOnly, category: filters.category || undefined, page: filters.page, size },
    });
    return data;
  },

  async unreadCount(): Promise<number> {
    const { data } = await apiClient.get<{ count: number }>('/notifications/unread-count');
    return data.count;
  },

  async markRead(id: string): Promise<void> {
    await apiClient.post(`/notifications/${encodeURIComponent(id)}/read`);
  },

  async markUnread(id: string): Promise<void> {
    await apiClient.post(`/notifications/${encodeURIComponent(id)}/unread`);
  },

  /** Returns how many notifications were marked read. */
  async markAllRead(): Promise<number> {
    const { data } = await apiClient.post<{ updated?: number } | ''>('/notifications/read-all');
    return typeof data === 'object' && data !== null ? (data.updated ?? 0) : 0;
  },

  async getPreferences(): Promise<NotificationPreferences> {
    const { data } = await apiClient.get<NotificationPreferences>('/notifications/preferences');
    return data;
  },

  async updatePreferences(body: UpdatePreferencesBody): Promise<NotificationPreferences> {
    const { data } = await apiClient.put<NotificationPreferences>('/notifications/preferences', body);
    return data;
  },
};
