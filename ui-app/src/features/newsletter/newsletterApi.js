import { apiClient } from '@/lib/api/client';

/**
 * `/api/newsletter` (API_DOCUMENTATION.md §10d): public and rate limited. Double opt-in: subscribing sends a link to
 * `/newsletter/confirm?token=…`; every newsletter e-mail links to `/newsletter/unsubscribe?token=…`.
 * Logged-in customers manage their account e-mail in the notification settings instead.
 */
export const newsletterApi = {
  /** Always `202`, whatever the address: nobody can find out which addresses are subscribed. */
  async subscribe(email) {
    await apiClient.post('/newsletter/subscribe', { email });
  },

  /** `400 INVALID_OR_EXPIRED_TOKEN` when the link is wrong, used or older than 48 hours. */
  async confirm(token) {
    const { data } = await apiClient.post('/newsletter/confirm', { token });
    return data;
  },

  /** `400 INVALID_TOKEN` when the link is wrong (these links do not expire). */
  async unsubscribe(token) {
    const { data } = await apiClient.post('/newsletter/unsubscribe', { token });
    return data;
  },
};
