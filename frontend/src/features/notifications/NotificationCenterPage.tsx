import { useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { CheckCheck, Settings } from 'lucide-react';
import { toast } from 'sonner';

import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Pagination } from '@/components/ui/Pagination';
import { PAGE_SIZES_UP_TO_50, readPageSize } from '@/components/ui/paginationItems';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { SectionHeader } from '@/features/account/AccountLayout';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import type { Page } from '@/lib/api/types';
import { safeRedirect } from '@/lib/auth/redirects';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { categoryLabel, categoryLabels, NOTIFICATION_CATEGORIES, readNotificationFilters } from './categories';
import { NotificationCategoryIcon } from './NotificationCategoryIcon';
import { notificationApi, type AppNotification } from './notificationApi';

/** Notifications per page unless `?size=` asks for another; the API allows at most 50. */
const DEFAULT_PAGE_SIZE = 25;

/**
 * /account/notifications — the Notification Center: every notification with read/unread status, All/Unread and
 * category filters (in the URL), mark one read or unread, mark all read. Live updates refresh it in place.
 */
export function NotificationCenterPage() {
  const [params, setParams] = useSearchParams();
  const filters = readNotificationFilters(params);
  const size = readPageSize(params, PAGE_SIZES_UP_TO_50, DEFAULT_PAGE_SIZE);
  const queryClient = useQueryClient();
  const listKey = queryKeys.notifications.list({ ...filters, size });
  const [problem, setProblem] = useState<ApiError | null>(null);

  const notifications = useQuery({
    queryKey: listKey,
    queryFn: () => notificationApi.search(filters, size),
    placeholderData: keepPreviousData,
  });
  const unread = useQuery({ queryKey: queryKeys.notifications.unreadCount, queryFn: notificationApi.unreadCount });
  const unreadCount = unread.data ?? 0;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
  const setRead = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => (read ? notificationApi.markRead(id) : notificationApi.markUnread(id)),
    onMutate: ({ id, read }) => {
      setProblem(null);
      queryClient.setQueryData<Page<AppNotification>>(listKey, (old) =>
        old && { ...old, content: old.content.map((item) => (item.id === id ? { ...item, read } : item)) });
    },
    onError: (error) => setProblem(ApiError.from(error)),
    onSettled: refresh,
  });
  const readAll = useMutation({
    mutationFn: notificationApi.markAllRead,
    onMutate: () => setProblem(null),
    onSuccess: (updated) => toast.success(updated === 1 ? '1 notification marked as read.' : `${updated} notifications marked as read.`),
    onError: (error) => setProblem(ApiError.from(error)),
    onSettled: refresh,
  });

  /** Filters live in the URL (the back button works); any change but paging starts at the first page. */
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const data = notifications.data;
  return (
    <div>
      <SectionHeader
        title="Notifications"
        description="Updates about your bookings, payments, refunds and support tickets."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <LiveIndicator />
            <ButtonLink to="/account/notifications/settings" variant="secondary" size="sm">
              <Settings className="size-4" aria-hidden="true" />
              Notification settings
            </ButtonLink>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card sm:p-4">
        <div role="group" aria-label="Show" className="inline-flex rounded-full bg-slate-100 p-1">
          <FilterButton pressed={!filters.unreadOnly} onClick={() => update({ unread: null })}>All</FilterButton>
          <FilterButton pressed={filters.unreadOnly} onClick={() => update({ unread: 'true' })}>
            Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </FilterButton>
        </div>
        <div className="w-full min-w-0 sm:w-48">
          <SelectField label="Category" value={filters.category} onChange={(event) => update({ category: event.target.value })}>
            <option value="">All categories</option>
            {NOTIFICATION_CATEGORIES.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}
          </SelectField>
        </div>
        <Button variant="secondary" className="sm:ml-auto" disabled={unreadCount === 0} loading={readAll.isPending} onClick={() => readAll.mutate()}>
          <CheckCheck className="size-4" aria-hidden="true" />
          Mark all as read
        </Button>
      </div>

      {problem && (
        <Alert tone="danger" className="mb-4" title="That did not work">
          {problem.message}
          {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
        </Alert>
      )}

      {notifications.isPending && <LoadingState label="Loading your notifications…" rows={4} />}
      {notifications.isError && (
        <ErrorState description={ApiError.from(notifications.error).message} correlationId={ApiError.from(notifications.error).correlationId}
          onRetry={() => void notifications.refetch()} />
      )}
      {data && data.content.length === 0 && (
        filters.page > 0
          ? <EmptyState title="Nothing on this page" action={<Button variant="secondary" onClick={() => update({})}>Go to the first page</Button>} />
          : <EmptyState {...emptyText(filters.unreadOnly, filters.category !== '')} />
      )}
      {data && data.content.length > 0 && (
        <>
          <ul className="flex flex-col gap-2.5 stagger" aria-label="Notifications">
            {data.content.map((notification) => (
              <NotificationRow key={notification.id} notification={notification}
                onSetRead={(read) => setRead.mutate({ id: notification.id, read })} />
            ))}
          </ul>
          <Pagination
            data={data}
            onPageChange={(page) => update({ page: String(page) })}
            onPageSizeChange={(next) => update({ size: next === DEFAULT_PAGE_SIZE ? null : String(next) })}
            pageSizes={PAGE_SIZES_UP_TO_50}
            noun={['notification', 'notifications']}
            sizeLabel="Per page"
            className="mt-4"
          />
        </>
      )}
    </div>
  );
}

function emptyText(unreadOnly: boolean, byCategory: boolean): { title: string; description: string } {
  if (unreadOnly) {
    return { title: 'You are all caught up', description: 'There are no unread notifications.' };
  }
  if (byCategory) {
    return { title: 'No notifications in this category', description: 'Choose another category to see more.' };
  }
  return { title: 'No notifications yet', description: 'We will tell you here when something happens with your bookings, payments or support tickets.' };
}

function FilterButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors duration-(--duration-fast)',
        pressed ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-700 hover:bg-white/70 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  );
}

function NotificationRow({ notification, onSetRead }: { notification: AppNotification; onSetRead: (read: boolean) => void }) {
  // Only paths inside this app are followed.
  const link = safeRedirect(notification.link);
  const action = notification.read ? 'Mark as unread' : 'Mark as read';
  return (
    <li>
      <Card
        className={cn(
          'relative flex flex-wrap items-start gap-3 overflow-hidden p-4 transition-colors duration-(--duration-base) sm:flex-nowrap sm:gap-4',
          !notification.read && 'border-brand-200 bg-brand-50/40',
        )}
      >
        {!notification.read && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-brand-600" />}
        <NotificationCategoryIcon category={notification.category} />
        {/* On phones the text takes the whole row next to the icon and the action moves under it. */}
        <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-auto">
          <p className="flex flex-wrap items-center gap-2">
            {link ? (
              <Link to={link} onClick={() => !notification.read && onSetRead(true)} className="break-words font-bold text-slate-900 hover:text-brand-700 hover:underline">
                {notification.title}
              </Link>
            ) : (
              <span className="break-words font-bold text-slate-900">{notification.title}</span>
            )}
            {!notification.read && <Badge tone="brand" dot>Unread</Badge>}
          </p>
          <p className="mt-1 break-words text-sm leading-relaxed text-slate-700">{notification.message}</p>
          <p className="mt-1.5 text-xs text-slate-500">
            {categoryLabel(notification.category)} · <time dateTime={notification.createdAt}>{formatDateTime(notification.createdAt)}</time>
          </p>
        </div>
        <Button variant="ghost" size="sm" className="ml-[3.25rem] shrink-0 sm:ml-0" aria-label={`${action}: ${notification.title}`} onClick={() => onSetRead(!notification.read)}>
          {action}
        </Button>
      </Card>
    </li>
  );
}
