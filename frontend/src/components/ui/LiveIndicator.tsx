import { useRealtimeStatus } from '@/app/providers/useRealtime';
import { cn } from '@/lib/cn';
import type { RealtimeStatus } from '@/lib/realtime/types';

const labels: Record<RealtimeStatus, string> = {
  idle: '',
  connecting: 'Connecting…',
  connected: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

const dots: Record<RealtimeStatus, string> = {
  idle: '',
  connecting: 'bg-warning-500',
  connected: 'bg-success-500 text-success-500',
  reconnecting: 'bg-warning-500 animate-pulse',
  offline: 'bg-slate-400',
};

/**
 * Small status dot: tells the user whether the screen is updating automatically. On phones only the dot shows (the
 * words stay for screen readers): "Reconnecting…" would make the header wider than the screen.
 */
export function LiveIndicator({ className }: { className?: string }) {
  const status = useRealtimeStatus();
  if (status === 'idle') {
    return null;
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-slate-600 sm:bg-slate-100/80 sm:ring-1 sm:ring-slate-200/80', className)}
      role="status"
      aria-live="polite"
      title={status === 'connected' ? 'This page updates automatically' : 'Live updates paused; data refreshes when reconnected'}
    >
      <span className="relative flex size-2" aria-hidden="true">
        {status === 'connected' && <span className="absolute inset-0 rounded-full animate-pulse-ring text-success-500" />}
        <span className={cn('relative size-2 rounded-full', dots[status])} />
      </span>
      <span className="sr-only sm:not-sr-only">{labels[status]}</span>
    </span>
  );
}
