import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { EmptyInboxIllustration } from '@/components/illustrations';
import { Skeleton } from '@/components/ui/Skeleton';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { NotificationCategoryIcon } from './NotificationCategoryIcon';
import { notificationApi, type AppNotification } from './notificationApi';

/**
 * The bell in the header: unread count and the latest notifications. Live updates refresh it (the realtime rule for
 * `notification.created`); a click opens the related page and marks the notification read; "See all notifications"
 * opens the Notification Center. Only for logged-in users.
 */
export function NotificationBell() {
  const { user } = useAuth();
  if (!user) {
    return null;
  }
  return <BellMenu />;
}

function BellMenu() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const unread = useQuery({ queryKey: queryKeys.notifications.unreadCount, queryFn: notificationApi.unreadCount });
  const latest = useQuery({
    queryKey: queryKeys.notifications.latest,
    queryFn: () => notificationApi.list(8),
    enabled: open,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
  const markRead = useMutation({ mutationFn: notificationApi.markRead, onSuccess: refresh });
  const markAll = useMutation({ mutationFn: notificationApi.markAllRead, onSuccess: refresh });

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const count = unread.data ?? 0;
  const openNotification = (notification: AppNotification) => {
    setOpen(false);
    if (!notification.read) markRead.mutate(notification.id);
    if (notification.link) void navigate(notification.link);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'relative flex size-10 items-center justify-center rounded-full text-slate-700 ring-1 transition-colors duration-(--duration-fast)',
          open ? 'bg-white text-role-700 ring-slate-300' : 'ring-transparent hover:bg-white hover:ring-slate-200',
        )}
      >
        <Bell className={cn('size-5', count > 0 && 'text-role-700')} aria-hidden="true" />
        {/* Named by screen-reader text with the exact count; the badge ("9+") is only the visual short form. */}
        <span className="sr-only">{count > 0 ? `Notifications, ${count} unread` : 'Notifications'}</span>
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 flex min-w-4.5 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-bold leading-[1.125rem] text-white ring-2 ring-white animate-scale-in"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        // Opens downward from the header: under the bell from sm up, across the screen below the header on phones.
        <div
          id={panelId}
          className={cn(
            'fixed inset-x-3 top-16 z-50 flex max-h-[calc(100dvh-10rem)] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl animate-scale-in',
            'sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:max-h-[min(36rem,calc(100dvh-6rem))] sm:w-96 sm:origin-top-right',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-b from-role-50/70 to-white px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
              Notifications
              {count > 0 && (
                <span className="rounded-full bg-role-600 px-2 py-0.5 text-xs font-semibold text-white">{count} new</span>
              )}
            </p>
            {count > 0 && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md text-xs font-semibold text-role-700 hover:underline"
                onClick={() => markAll.mutate()}
              >
                <CheckCheck className="size-3.5" aria-hidden="true" />
                Mark all read
              </button>
            )}
          </div>
          {latest.isPending && (
            <div className="flex flex-col gap-3 px-4 py-4">
              <span className="sr-only">Loading…</span>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-start gap-3">
                  <Skeleton className="size-8 shrink-0 rounded-xl" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {latest.data && latest.data.content.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              <EmptyInboxIllustration className="w-24" />
              <p className="text-sm text-slate-600">You have no notifications yet.</p>
            </div>
          )}
          {latest.data && latest.data.content.length > 0 && (
            <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto overscroll-contain" aria-label="Latest notifications">
              {latest.data.content.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-(--duration-fast) hover:bg-slate-50',
                      !notification.read && 'bg-role-50/50',
                    )}
                  >
                    <NotificationCategoryIcon category={notification.category} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="min-w-0 break-words">{notification.title}</span>
                        {!notification.read && <span role="img" className="size-2 shrink-0 rounded-full bg-role-600" aria-label="Unread" />}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm text-slate-600">{notification.message}</span>
                      <span className="mt-1 block text-xs text-slate-500">{formatDateTime(notification.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-center">
            <Link
              to="/account/notifications"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 text-sm font-semibold text-role-700 hover:underline"
            >
              See all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
