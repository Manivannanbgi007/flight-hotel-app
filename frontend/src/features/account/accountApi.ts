import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';
import type { AuthResponse } from '@/lib/auth/types';
import type {
  ChangePasswordRequest,
  LoginHistoryEntry,
  Passenger,
  PassengerRequest,
  Profile,
  TravelPreferences,
  UpdateProfileRequest,
} from './types';

/** `/api/customers` endpoints (API_DOCUMENTATION.md §3): the logged-in user's own account. */
export const accountApi = {
  async getProfile(): Promise<Profile> {
    const { data } = await apiClient.get<Profile>('/customers/profile');
    return data;
  },

  async updateProfile(body: UpdateProfileRequest): Promise<Profile> {
    const { data } = await apiClient.put<Profile>('/customers/profile', body);
    return data;
  },

  async uploadPhoto(file: File): Promise<Profile> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await apiClient.put<Profile>('/customers/profile/photo', form);
    return data;
  },

  /** The photo is only served with the owner's token, so it is loaded as a blob (never a public URL). */
  async getPhoto(): Promise<Blob> {
    // The client's default "Accept: application/json" would get 406 from an image endpoint.
    const { data } = await apiClient.get<Blob>('/customers/profile/photo', {
      responseType: 'blob',
      headers: { Accept: 'image/jpeg' },
    });
    return data;
  },

  async deletePhoto(): Promise<void> {
    await apiClient.delete('/customers/profile/photo');
  },

  async listPassengers(): Promise<Passenger[]> {
    const { data } = await apiClient.get<Passenger[]>('/customers/passengers');
    return data;
  },

  async createPassenger(body: PassengerRequest): Promise<Passenger> {
    const { data } = await apiClient.post<Passenger>('/customers/passengers', body);
    return data;
  },

  async updatePassenger(id: string, body: PassengerRequest): Promise<Passenger> {
    const { data } = await apiClient.put<Passenger>(`/customers/passengers/${encodeURIComponent(id)}`, body);
    return data;
  },

  async deletePassenger(id: string): Promise<void> {
    await apiClient.delete(`/customers/passengers/${encodeURIComponent(id)}`);
  },

  async getPreferences(): Promise<TravelPreferences> {
    const { data } = await apiClient.get<TravelPreferences>('/customers/preferences');
    return data;
  },

  async updatePreferences(body: TravelPreferences): Promise<TravelPreferences> {
    const { data } = await apiClient.put<TravelPreferences>('/customers/preferences', body);
    return data;
  },

  /** Returns a fresh access token for this session; every other session is logged out. */
  async changePassword(body: ChangePasswordRequest): Promise<AuthResponse> {
    const { data } = await apiClient.post<AuthResponse>('/customers/security/change-password', body);
    return data;
  },

  async logoutEverywhere(): Promise<void> {
    await apiClient.post('/customers/security/logout-all');
  },

  async loginHistory(page: number, size = 10): Promise<Page<LoginHistoryEntry>> {
    const { data } = await apiClient.get<Page<LoginHistoryEntry>>('/customers/security/login-history', {
      params: { page, size },
    });
    return data;
  },
};
