import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';
import type { Role } from '@/lib/auth/types';

/** `/api/admin/users` (API_DOCUMENTATION.md §4): read with USER_READ_ANY, change with USER_MANAGE. */
export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'DEACTIVATED';

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  roles: Role[];
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export type UserFilters = {
  search: string;
  role: Role | '';
  status: UserStatus | '';
  page: number;
  sort?: string;
};

export interface InviteStaffBody {
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
}

const userPath = (userId: string) => `/admin/users/${encodeURIComponent(userId)}`;

export const userApi = {
  async list(filters: UserFilters, size = 20): Promise<Page<AdminUser>> {
    const { data } = await apiClient.get<Page<AdminUser>>('/admin/users', {
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

  async get(userId: string): Promise<AdminUser> {
    const { data } = await apiClient.get<AdminUser>(userPath(userId));
    return data;
  },

  /** `201`: the person gets a "set your password" e-mail. `409 EMAIL_ALREADY_REGISTERED` when the address is taken. */
  async invite(body: InviteStaffBody): Promise<AdminUser> {
    const { data } = await apiClient.post<AdminUser>('/admin/users', body);
    return data;
  },

  /** Deactivating ends every session of that user at once. `422 CANNOT_CHANGE_OWN_ACCOUNT` for yourself. */
  async changeStatus(userId: string, status: 'ACTIVE' | 'DEACTIVATED', reason: string): Promise<AdminUser> {
    const { data } = await apiClient.patch<AdminUser>(`${userPath(userId)}/status`, { status, reason: reason || undefined });
    return data;
  },

  /** `422 CANNOT_CHANGE_OWN_ACCOUNT` when removing your own ADMIN role, `422 UNKNOWN_ROLE`. */
  async changeRoles(userId: string, roles: Role[]): Promise<AdminUser> {
    const { data } = await apiClient.put<AdminUser>(`${userPath(userId)}/roles`, { roles });
    return data;
  },
};
