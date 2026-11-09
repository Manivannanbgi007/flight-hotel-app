import { apiClient } from '@/lib/api/client';

/** `/api/admin/settings` (API_DOCUMENTATION.md §12, role ADMIN; changing needs SETTINGS_MANAGE). */
export type SettingValueType = 'STRING' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DURATION';

export interface SystemSetting {
  key: string;
  value: string | null;
  valueType: SettingValueType;
  description: string | null;
  publicSetting: boolean;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const settingsApi = {
  async list(): Promise<SystemSetting[]> {
    const { data } = await apiClient.get<SystemSetting[]>('/admin/settings');
    return data;
  },

  /**
   * `expectedVersion` = the version on screen: `409 SETTING_CHANGED_BY_SOMEONE_ELSE` when it is stale,
   * `422 INVALID_SETTING_VALUE` when the value does not fit the type. Every service picks the change up within seconds.
   */
  async update(key: string, value: string, expectedVersion: number): Promise<SystemSetting> {
    const { data } = await apiClient.put<SystemSetting>(`/admin/settings/${encodeURIComponent(key)}`, { value, expectedVersion });
    return data;
  },
};

const GROUPS: Record<string, string> = {
  site: 'Site',
  support: 'Customer support',
  currency: 'Money',
  booking: 'Bookings',
  hotel: 'Hotels and tax',
  reviews: 'Reviews',
  notifications: 'Notifications',
};

/** Settings grouped by the first part of the key (`booking.payment-window-minutes` → Bookings), in a stable order. */
export function groupSettings(settings: SystemSetting[]): { group: string; settings: SystemSetting[] }[] {
  const groups = new Map<string, SystemSetting[]>();
  for (const setting of [...settings].sort((a, b) => a.key.localeCompare(b.key))) {
    const prefix = setting.key.split('.')[0] ?? setting.key;
    const name = GROUPS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
    groups.set(name, [...(groups.get(name) ?? []), setting]);
  }
  const order = Object.values(GROUPS);
  return [...groups.entries()]
    .sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || a.localeCompare(b))
    .map(([group, list]) => ({ group, settings: list }));
}

/** Why `value` does not fit `type` (same checks as reporting-service), or null. */
export function settingValueProblem(type: SettingValueType, value: string): string | null {
  const text = value.trim();
  switch (type) {
    case 'INTEGER':
      return /^-?\d+$/.test(text) ? null : 'Enter a whole number.';
    case 'DECIMAL':
      return /^-?\d+(\.\d+)?$/.test(text) ? null : 'Enter a number, for example 7500 or 2.5.';
    case 'BOOLEAN':
      return text === 'true' || text === 'false' ? null : 'Choose on or off.';
    case 'DURATION':
      return /^P(?!$)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/i.test(text) ? null : 'Enter a duration like PT15M (15 minutes) or P1D (1 day).';
    default:
      return text.length > 2000 ? 'Use at most 2,000 characters.' : null;
  }
}
