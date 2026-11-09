import { useId, useState } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Mail, Newspaper, Smartphone } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { tableStyles } from '@/components/ui/dataTableStyles';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/StateViews';
import { BackLink } from '@/features/account/BackLink';
import { Switch } from '@/components/ui/Switch';
import { SectionHeader } from '@/features/account/AccountLayout';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { categoryDescriptions, categoryLabel, channelLabels, NOTIFICATION_CATEGORIES } from './categories';
import { NotificationCategoryIcon } from './NotificationCategoryIcon';
import {
  notificationApi,
  type NewsletterStatus,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreference,
  type NotificationPreferences,
  type UpdatePreferencesBody,
} from './notificationApi';

const CHANNELS: readonly NotificationChannel[] = ['EMAIL', 'IN_APP'];
const SAVE_KEY = ['notification-preferences', 'save'] as const;

/** One switch flipped; `previous` lets a refused newsletter change go back exactly. */
type Change =
  | { kind: 'item'; category: NotificationCategory; channel: NotificationChannel; enabled: boolean }
  | { kind: 'newsletter'; subscribed: boolean; previous: NotificationPreferences['newsletter'] };

/**
 * /account/notifications/settings — which topics reach the customer by e-mail and in the app, and the newsletter of the
 * account e-mail. Every switch is saved at once (`PUT` with only that item); locked ones are shown on and cannot change.
 */
export function NotificationSettingsPage() {
  const preferences = useQuery({ queryKey: queryKeys.notifications.preferences, queryFn: notificationApi.getPreferences });
  return (
    <div>
      <BackLink to="/account/notifications" className="mb-3">Back to notifications</BackLink>
      <SectionHeader title="Notification settings" description="Choose how we keep you posted. Changes are saved at once." />
      {preferences.isPending && (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-12 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      )}
      {preferences.isError && (
        <ErrorState description={ApiError.from(preferences.error).message} correlationId={ApiError.from(preferences.error).correlationId}
          onRetry={() => void preferences.refetch()} />
      )}
      {preferences.data && <PreferencesEditor preferences={preferences.data} />}
    </div>
  );
}

function applyChange(preferences: NotificationPreferences, change: Change): NotificationPreferences {
  if (change.kind === 'newsletter') {
    return { ...preferences, newsletter: { subscribed: change.subscribed, status: change.subscribed ? 'SUBSCRIBED' : 'UNSUBSCRIBED' } };
  }
  return {
    ...preferences,
    items: preferences.items.map((item) =>
      item.category === change.category && item.channel === change.channel ? { ...item, enabled: change.enabled } : item),
  };
}

function undoChange(preferences: NotificationPreferences, change: Change): NotificationPreferences {
  return change.kind === 'newsletter'
    ? { ...preferences, newsletter: change.previous }
    : applyChange(preferences, { ...change, enabled: !change.enabled });
}

function toBody(change: Change): UpdatePreferencesBody {
  return change.kind === 'newsletter'
    ? { items: [], newsletter: change.subscribed }
    : { items: [{ category: change.category, channel: change.channel, enabled: change.enabled }] };
}

/** The categories the server sent, in the usual order (unknown ones last). */
function categoriesOf(items: readonly NotificationPreference[]): NotificationCategory[] {
  const present = new Set(items.map((item) => item.category));
  const known = NOTIFICATION_CATEGORIES.filter((category) => present.has(category));
  return [...known, ...[...present].filter((category) => !NOTIFICATION_CATEGORIES.includes(category))];
}

function PreferencesEditor({ preferences }: { preferences: NotificationPreferences }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const lockedNoteId = useId();
  const [problem, setProblem] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const saving = useIsMutating({ mutationKey: SAVE_KEY }) > 0;
  const key = queryKeys.notifications.preferences;

  // Optimistic: the switch moves at once and goes back if the server refuses. Switches never get disabled while
  // saving, so keyboard focus stays where it is.
  const save = useMutation({
    mutationKey: SAVE_KEY,
    mutationFn: (change: Change) => notificationApi.updatePreferences(toBody(change)),
    onMutate: async (change) => {
      setProblem(null);
      setSaved(false);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<NotificationPreferences>(key, (old) => old && applyChange(old, change));
    },
    onError: (error, change) => {
      queryClient.setQueryData<NotificationPreferences>(key, (old) => old && undoChange(old, change));
      setProblem(ApiError.from(error));
    },
    onSuccess: (latest) => {
      // Several switches may be saving at once: only the last answer has every change in it.
      if (queryClient.isMutating({ mutationKey: SAVE_KEY }) === 1) {
        queryClient.setQueryData(key, latest);
        setSaved(true);
      }
    },
  });

  const find = (category: NotificationCategory, channel: NotificationChannel) =>
    preferences.items.find((item) => item.category === category && item.channel === channel);
  const hasLocked = preferences.items.some((item) => item.locked);

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="min-h-5 text-sm text-slate-600">{saving ? 'Saving…' : saved ? 'Changes saved.' : ''}</p>
      {problem && (
        <Alert tone="danger" title="Your change was not saved">
          {problem.message}
          {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
        </Alert>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <caption className="sr-only">Notifications by topic: by e-mail and in the app</caption>
          <thead>
            <tr>
              <th scope="col" className={`${tableStyles.th} text-left`}>Topic</th>
              {CHANNELS.map((channel) => (
                <th
                  key={channel}
                  scope="col"
                  className={`${tableStyles.headSurface} ${tableStyles.headType} w-20 px-2 py-3 text-center text-role-800 sm:w-28`}
                >
                  <span className="inline-flex flex-col items-center gap-1 sm:flex-row sm:gap-1.5">
                    {channel === 'EMAIL' ? <Mail className="size-4" aria-hidden="true" /> : <Smartphone className="size-4" aria-hidden="true" />}
                    {channelLabels[channel]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={tableStyles.tbody}>
            {categoriesOf(preferences.items).map((category) => (
              <tr key={category} className={tableStyles.tr}>
                <th scope="row" className="px-4 py-3.5 text-left font-normal">
                  <span className="flex items-start gap-3">
                    <NotificationCategoryIcon category={category} size="sm" className="hidden sm:flex" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-900">{categoryLabel(category)}</span>
                      {categoryDescriptions[category] && <span className="block text-xs text-slate-600">{categoryDescriptions[category]}</span>}
                    </span>
                  </span>
                </th>
                {CHANNELS.map((channel) => {
                  const item = find(category, channel);
                  return (
                    <td key={channel} className="px-2 py-3.5 text-center">
                      {item ? (
                        <div className="inline-flex flex-col items-center gap-1">
                          <Switch
                            checked={item.locked || item.enabled}
                            disabled={item.locked}
                            aria-label={`${categoryLabel(category)}: ${channelLabels[channel]}`}
                            aria-describedby={item.locked ? lockedNoteId : undefined}
                            onCheckedChange={(enabled) => save.mutate({ kind: 'item', category, channel, enabled })}
                          />
                          {item.locked && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                              <Lock className="size-3" aria-hidden="true" /> Always on
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500"><span aria-hidden="true">–</span><span className="sr-only">Not available</span></span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p id={lockedNoteId} className="-mt-2 text-xs text-slate-600">
        {hasLocked && 'E-mails about your bookings, payments and refunds (confirmations, receipts, cancellations and refunds) are always sent. '}
        Account and security messages are always sent too.
      </p>

      <NewsletterSetting
        newsletter={preferences.newsletter}
        email={user?.email ?? 'your account e-mail'}
        onChange={(subscribed) => save.mutate({ kind: 'newsletter', subscribed, previous: preferences.newsletter })}
      />
    </div>
  );
}

const newsletterStatusText: Record<NewsletterStatus, string> = {
  SUBSCRIBED: 'You are subscribed.',
  PENDING: 'Waiting for you to confirm the link we e-mailed. Switch it on here to subscribe right away.',
  UNSUBSCRIBED: 'You are not subscribed.',
  NONE: 'You are not subscribed.',
};

function NewsletterSetting({ newsletter, email, onChange }: {
  newsletter: NotificationPreferences['newsletter'];
  email: string;
  onChange: (subscribed: boolean) => void;
}) {
  const headingId = useId();
  const hintId = useId();
  return (
    <Card className="bg-gradient-to-br from-white to-accent-50/60 p-5">
      <div className="flex items-start justify-between gap-4">
        <span aria-hidden="true" className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700 ring-1 ring-accent-200 sm:flex">
          <Newspaper className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="font-bold text-slate-900">Newsletter</h3>
          <p id={hintId} className="mt-0.5 break-words text-sm text-slate-600">
            Travel deals and news, sent to {email}. You can unsubscribe at any time.
          </p>
          <p className="mt-1 text-sm text-slate-700">{newsletterStatusText[newsletter.status] ?? ''}</p>
        </div>
        <Switch checked={newsletter.subscribed} aria-labelledby={headingId} aria-describedby={hintId} onCheckedChange={onChange} />
      </div>
    </Card>
  );
}
