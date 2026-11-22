import { isRouteErrorResponse, useRouteError } from 'react-router';

import { MinimalFrame } from '@/components/layout/MinimalFrame';
import { ErrorState } from '@/components/ui/StateViews';
import { NotFoundPage } from './NotFoundPage';

/** Catches errors thrown while rendering a route, so one broken page never blanks the whole app. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />;
  }
  return (
    <MinimalFrame>
      <div className="mx-auto w-full max-w-xl px-4 py-16 sm:py-24">
        <ErrorState
          title="This page could not be displayed"
          description="Please reload the page. If the problem continues, contact support."
          onRetry={() => window.location.reload()}
        />
      </div>
    </MinimalFrame>
  );
}
