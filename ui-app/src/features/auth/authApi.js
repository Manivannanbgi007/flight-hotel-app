import { apiClient } from '@/lib/api/client';

/** `/api/auth` endpoints (API_DOCUMENTATION.md §2). Refresh lives in lib/api/client.js because the interceptor needs it. */
export const authApi = {
  async register(body) {
    const { data } = await apiClient.post('/auth/register', body);
    return data;
  },

  async login(body) {
    const { data } = await apiClient.post('/auth/login', body);
    return data;
  },

  /**
   * Revokes the refresh cookie and, when sent, the current access token. `accessToken` is for a session that was never
   * stored (a login the UI refused because the account does not belong to this sign-in page).
   */
  async logout(accessToken) {
    if (accessToken) {
      await apiClient.post('/auth/logout', null, { headers: { Authorization: `Bearer ${accessToken}` } });
    } else {
      await apiClient.post('/auth/logout');
    }
  },

  async verifyEmail(token) {
    const { data } = await apiClient.post('/auth/verify-email', { token });
    return data;
  },

  async resendVerification(email) {
    const { data } = await apiClient.post('/auth/resend-verification', { email });
    return data;
  },

  async forgotPassword(email) {
    const { data } = await apiClient.post('/auth/forgot-password', { email });
    return data;
  },

  async resetPassword(body) {
    const { data } = await apiClient.post('/auth/reset-password', body);
    return data;
  },
};
