import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2 } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { AssistantMascot } from './AssistantMascot';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { accentClassOf, shouldShowLauncher, useAssistantConfig } from './assistantConfig';
import { clearConversationId } from './conversationStorage';
import { ASSISTANT_PANEL_ID, panelFrameClass, type PanelSize } from './panelFrame';
import { useStoredFlag } from './uiHooks';
import { useAvoidBottomBars } from './useAvoidBottomBars';

const loadPanel = () => import('./AssistantPanel');
const AssistantPanel = lazy(loadPanel);

/** `busy`: an answer is being written while the panel is closed; `unread`: it finished while the panel was closed. */
export type LauncherActivity = 'idle' | 'busy' | 'unread';

interface LauncherState {
  userId: string | null;
  open: boolean;
  /** The panel was opened once: it stays mounted (hidden) so the conversation and a running answer survive closing. */
  mounted: boolean;
  activity: LauncherActivity;
}

/**
 * The AI assistant's floating button (bottom-right) and its lazily loaded chat panel. Mounted once for the whole app
 * (AppRoot), so it works on every customer page and in every staff portal without touching their layouts. It shows
 * only for signed-in users while `GET /api/assistant/config` says `enabled`. The colour follows the portal of the page.
 *
 * Three states: minimized (only this button), normal (the docked panel) and maximized (the panel fills the window,
 * the page dimmed behind it; this button is hidden, the panel has Minimize and Restore). The size is remembered on the
 * device. The button moves out of the way of pagination and bottom bars (`useAvoidBottomBars`).
 */
export function AssistantLauncher() {
  const { status, user } = useAuth();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const signedIn = status === 'authenticated' && user !== null;
  const userId = signedIn ? user.id : null;
  const { data: config } = useAssistantConfig(signedIn);

  const [state, setState] = useState<LauncherState>({ userId, open: false, mounted: false, activity: 'idle' });
  if (state.userId !== userId) {
    // Signed out or another account: close and drop the panel (its conversation belongs to the previous user).
    setState({ userId, open: false, mounted: false, activity: 'idle' });
  }

  // ...and forget the previous user's conversation id in this tab.
  const previousUser = useRef(userId);
  useEffect(() => {
    if (previousUser.current && previousUser.current !== userId) {
      clearConversationId(previousUser.current);
    }
    previousUser.current = userId;
  }, [userId]);

  const [maximized, setMaximized] = useStoredFlag('fh.assistant.maximized', false);
  const size: PanelSize = maximized ? 'maximized' : 'normal';
  const launcherRef = useRef<HTMLButtonElement>(null);
  const visible = shouldShowLauncher({ status, config, pathname });
  const lift = useAvoidBottomBars(launcherRef, visible && !state.open);

  // Closing (close button, Escape, the launcher itself) gives the focus back to the launcher once it is visible again.
  const returnFocus = useRef(false);
  const close = useCallback(() => {
    returnFocus.current = true;
    setState((current) => ({ ...current, open: false }));
  }, []);
  useEffect(() => {
    if (!state.open && returnFocus.current) {
      returnFocus.current = false;
      launcherRef.current?.focus();
    }
  }, [state.open]);

  const toggle = () => {
    if (state.open) {
      close();
      return;
    }
    setState((current) => ({ ...current, open: true, mounted: true, activity: 'idle' }));
    // The contract: check the config again when the chat opens (the model may have gone away).
    void queryClient.invalidateQueries({ queryKey: queryKeys.assistant.config });
  };

  // The panel reports whether an answer is being written; the launcher shows it while the panel is closed.
  const onActivity = useCallback((busy: boolean) => {
    setState((current) => {
      let activity: LauncherActivity;
      if (current.open) activity = 'idle';
      else if (busy) activity = 'busy';
      else activity = current.activity === 'busy' ? 'unread' : current.activity;
      return activity === current.activity ? current : { ...current, activity };
    });
  }, []);

  if (!signedIn || (!visible && !state.mounted)) {
    return null;
  }
  const label = state.open
    ? 'Minimize the assistant'
    : state.activity === 'unread'
      ? 'Open the assistant (new answer)'
      : state.activity === 'busy'
        ? 'Open the assistant (answer in progress)'
        : 'Open the assistant';

  return (
    <div data-assistant-root="" className={accentClassOf(pathname)}>
      {(visible || state.open) && (
        <button
          ref={launcherRef}
          type="button"
          aria-label={label}
          aria-expanded={state.open}
          aria-controls={state.mounted ? ASSISTANT_PANEL_ID : undefined}
          onClick={toggle}
          onPointerEnter={() => void loadPanel()}
          onFocus={() => void loadPanel()}
          style={lift ? { transform: `translateY(-${lift}px)` } : undefined}
          className={cn(
            'group fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex size-14 items-center justify-center rounded-full sm:bottom-6 sm:right-6',
            'bg-[linear-gradient(135deg,var(--role-400),var(--role-600)_55%,var(--role-800))] text-white',
            'shadow-[0_10px_30px_-8px_color-mix(in_srgb,var(--role-600)_70%,transparent)] ring-4 ring-white/80',
            'transition-[transform,scale,box-shadow] duration-(--duration-base) ease-out-soft hover:scale-105 active:scale-95',
            'focus-visible:outline-offset-4',
            state.open && (maximized ? 'hidden' : 'max-sm:hidden'),
          )}
        >
          {/* A soft inner light, for depth. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-1 rounded-full bg-[radial-gradient(circle_at_30%_25%,rgb(255_255_255/0.35),transparent_60%)]" />
          {state.open ? (
            <ChevronDown className="relative size-6" aria-hidden="true" />
          ) : (
            <AssistantMascot busy={state.activity === 'busy'} className="relative size-10 transition-transform duration-(--duration-base) ease-spring group-hover:scale-110 group-hover:-rotate-6" />
          )}
          {!state.open && state.activity !== 'idle' && (
            <span aria-hidden="true" className="absolute right-0.5 top-0.5 flex size-3.5">
              {state.activity === 'busy' && <span className="absolute inset-0 rounded-full bg-accent-400 animate-pulse-ring" />}
              <span className="relative size-3.5 rounded-full bg-accent-500 ring-2 ring-white" />
            </span>
          )}
        </button>
      )}
      {state.open && maximized && (
        // Maximized: the page is dimmed behind the panel; a click on it minimizes the panel.
        <div aria-hidden="true" onClick={close} className="fixed inset-0 z-50 hidden bg-slate-950/35 backdrop-blur-[2px] animate-fade-in sm:block" />
      )}
      {state.mounted && config && (
        <Suspense fallback={state.open ? <PanelLoading size={size} /> : null}>
          <AssistantPanel
            open={state.open}
            onClose={close}
            size={size}
            onSizeChange={(next) => setMaximized(next === 'maximized')}
            config={config}
            user={user}
            onActivity={onActivity}
          />
        </Suspense>
      )}
    </div>
  );
}

/** While the panel's code downloads (only the first time). */
function PanelLoading({ size }: { size: PanelSize }) {
  return (
    <div className={cn(panelFrameClass(size), 'items-center justify-center')}>
      <Loader2 className="size-6 animate-spin text-role-600" aria-hidden="true" />
      <p role="status" className="mt-2 text-sm text-slate-600">Opening the assistant…</p>
    </div>
  );
}
