import { apiClient } from '@/lib/api/client';
import type { MessageResponse } from '@/lib/api/types';
import type { Portal } from '@/lib/auth/portals';
import type { AuthResponse } from '@/lib/auth/types';

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  acceptTerms: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe: boolean;
  /** The sign-in page the request comes from; identity-service refuses accounts without a matching role (403 PORTAL_NOT_ALLOWED). */
  portal?: Portal;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

/** `/api/auth` endpoints (API_DOCUMENTATION.md §2). Refresh lives in lib/api/client.ts because the interceptor needs it. */
export const authApi = {
  async register(body: RegisterRequest): Promise<MessageResponse> {
    const { data } = await apiClient.post<MessageResponse>('/auth/register', body);
    return data;
  },

  async login(body: LoginRequest): Promise<AuthResponse> {
    const { data } = await apiClient.post<AuthResponse>('/auth/login', body);
    return data;
  },

  /**
   * Revokes the refresh cookie and, when sent, the current access token. `accessToken` is for a session that was never
   * stored (a login the UI refused because the account does not belong to this sign-in page).
   */
  async logout(accessToken?: string): Promise<void> {
    if (accessToken) {
      await apiClient.post('/auth/logout', null, { headers: { Authorization: `Bearer ${accessToken}` } });
    } else {
      await apiClient.post('/auth/logout');
    }
  },

  async verifyEmail(token: string): Promise<MessageResponse> {
    const { data } = await apiClient.post<MessageResponse>('/auth/verify-email', { token });
    return data;
  },

  async resendVerification(email: string): Promise<MessageResponse> {
    const { data } = await apiClient.post<MessageResponse>('/auth/resend-verification', { email });
    return data;
  },

  async forgotPassword(email: string): Promise<MessageResponse> {
    const { data } = await apiClient.post<MessageResponse>('/auth/forgot-password', { email });
    return data;
  },

  async resetPassword(body: ResetPasswordRequest): Promise<MessageResponse> {
    const { data } = await apiClient.post<MessageResponse>('/auth/reset-password', body);
    return data;
  },
};
