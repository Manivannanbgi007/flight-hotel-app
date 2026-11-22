import { Outlet, ScrollRestoration } from 'react-router';

import { AssistantLauncher } from '@/features/assistant/AssistantLauncher';
import { AuthRouterBridge } from './AuthRouterBridge';

/**
 * Root of every route: router-side helpers that need to live inside the router, and the AI assistant's launcher
 * (on every page and portal; its panel is loaded on first use).
 */
export function AppRoot() {
  return (
    <>
      <AuthRouterBridge />
      <ScrollRestoration />
      <Outlet />
      <AssistantLauncher />
    </>
  );
}
