import { act, screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { realtimeBus } from '@/lib/realtime/eventBus';
import { applyInvalidation } from '@/lib/realtime/invalidationRules';
import type { RealtimeMessage } from '@/lib/realtime/types';
import { adminWithout, renderAdmin } from '../testUtils';
import { AdminSettingsPage } from './AdminSettingsPage';
import { groupSettings, settingsApi, settingValueProblem, type SystemSetting } from './settingsApi';

const setting = (overrides: Partial<SystemSetting> = {}): SystemSetting => ({
  key: 'booking.payment-window-minutes', value: '15', valueType: 'INTEGER', description: 'Minutes a customer has to pay', publicSetting: false,
  version: 2, updatedAt: '2026-11-01T10:00:00Z', updatedBy: 'admin-1', ...overrides,
});

const all = () => [
  setting(),
  setting({ key: 'site.name', value: 'FlightHotel', valueType: 'STRING', description: 'Brand name', publicSetting: true, version: 0 }),
  setting({ key: 'reviews.require-moderation', value: 'true', valueType: 'BOOLEAN', description: 'Moderate reviews', version: 1 }),
];

const routes = [{ path: '/admin/settings', element: <AdminSettingsPage /> }];
const changed = (key: string, version: number): RealtimeMessage => ({
  id: 'm1', type: 'settings.changed', resourceType: 'SYSTEM_SETTING', resourceId: key, data: { version }, occurredAt: '2026-11-05T10:00:00Z',
});

describe('AdminSettingsPage', () => {
  it('lists the settings grouped, with type-aware values', async () => {
    vi.spyOn(settingsApi, 'list').mockResolvedValue(all());
    renderAdmin(routes, '/admin/settings');

    const site = await screen.findByRole('region', { name: 'Site' });
    expect(site).toHaveTextContent('site.namePublic');
    expect(site).toHaveTextContent('FlightHotel');
    expect(screen.getByRole('region', { name: 'Bookings' })).toHaveTextContent('15');
    expect(screen.getByRole('region', { name: 'Reviews' })).toHaveTextContent('On');
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Site', 'Bookings', 'Reviews']);
  });

  it('saves a change with the version on screen', async () => {
    vi.spyOn(settingsApi, 'list').mockResolvedValue(all());
    const update = vi.spyOn(settingsApi, 'update').mockResolvedValue(setting({ value: '20', version: 3 }));
    const { user } = renderAdmin(routes, '/admin/settings');

    await user.click(await screen.findByRole('button', { name: 'Change booking.payment-window-minutes' }));
    const input = screen.getByLabelText('New value');
    await user.clear(input);
    await user.type(input, '2o');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a whole number.')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '20');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('booking.payment-window-minutes', '20', 2));
    expect(await screen.findByText('booking.payment-window-minutes saved.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Bookings' })).toHaveTextContent('version 3');
  });

  it('reloads and shows the other admin\'s value after 409 SETTING_CHANGED_BY_SOMEONE_ELSE, then saves on the new version', async () => {
    const list = vi.spyOn(settingsApi, 'list').mockResolvedValue(all());
    const update = vi.spyOn(settingsApi, 'update')
      .mockRejectedValueOnce(new ApiError(409, 'SETTING_CHANGED_BY_SOMEONE_ELSE', 'This setting was changed by someone else. Reload and try again.'))
      .mockResolvedValueOnce(setting({ value: '25', version: 4 }));
    const { user } = renderAdmin(routes, '/admin/settings');

    await user.click(await screen.findByRole('button', { name: 'Change booking.payment-window-minutes' }));
    await user.clear(screen.getByLabelText('New value'));
    await user.type(screen.getByLabelText('New value'), '25');
    list.mockResolvedValue([setting({ value: '30', version: 3, updatedBy: 'admin-2' }), ...all().slice(1)]);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const warning = await screen.findByText('Someone else changed this setting');
    await waitFor(() => expect(warning.closest('[role="alert"]')).toHaveTextContent('The value is now 30. Saving replaces it with yours.'));
    expect(screen.getByLabelText('New value')).toHaveValue('25');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenLastCalledWith('booking.payment-window-minutes', '25', 3));
  });

  it('tells the admin when another admin changed a setting live, and refreshes it', async () => {
    const list = vi.spyOn(settingsApi, 'list').mockResolvedValue(all());
    const { queryClient } = renderAdmin(routes, '/admin/settings');
    await screen.findByRole('region', { name: 'Site' });
    list.mockResolvedValue([setting(), setting({ key: 'site.name', value: 'TripNest', valueType: 'STRING', publicSetting: true, version: 1 }), all()[2]!]);

    act(() => {
      realtimeBus.publish(changed('site.name', 1));
      applyInvalidation(queryClient, changed('site.name', 1));
    });

    expect(await screen.findByText(/was just changed by another admin/)).toHaveTextContent('site.name was just changed by another admin.');
    expect(await within(screen.getByRole('region', { name: 'Site' })).findByText('TripNest')).toBeInTheDocument();
  });

  it('is read-only without SETTINGS_MANAGE', async () => {
    vi.spyOn(settingsApi, 'list').mockResolvedValue(all());
    renderAdmin(routes, '/admin/settings', adminWithout('SETTINGS_MANAGE'));

    expect(await screen.findByText('You can see the settings but not change them.')).toBeInTheDocument();
    await screen.findByRole('region', { name: 'Site' });
    expect(screen.queryByRole('button', { name: /^Change / })).not.toBeInTheDocument();
  });

  it('shows the server\'s reason for an invalid value', async () => {
    vi.spyOn(settingsApi, 'list').mockResolvedValue(all());
    vi.spyOn(settingsApi, 'update').mockRejectedValue(new ApiError(422, 'INVALID_SETTING_VALUE', 'Value is not a valid string', [], 'corr-16'));
    const { user } = renderAdmin(routes, '/admin/settings');

    await user.click(await screen.findByRole('button', { name: 'Change site.name' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Value is not a valid string')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-16')).toBeInTheDocument();
  });
});

describe('settings helpers', () => {
  it('groups by the first part of the key in a fixed order', () => {
    expect(groupSettings(all()).map((group) => group.group)).toEqual(['Site', 'Bookings', 'Reviews']);
  });

  it('checks values by type', () => {
    expect(settingValueProblem('DECIMAL', '7500.5')).toBeNull();
    expect(settingValueProblem('DECIMAL', '7,500')).toBe('Enter a number, for example 7500 or 2.5.');
    expect(settingValueProblem('DURATION', 'PT15M')).toBeNull();
    expect(settingValueProblem('DURATION', '15 minutes')).not.toBeNull();
    expect(settingValueProblem('BOOLEAN', 'yes')).toBe('Choose on or off.');
  });
});
