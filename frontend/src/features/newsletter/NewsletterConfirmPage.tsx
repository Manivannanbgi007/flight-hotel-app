import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/layout/PageContainer';
import { ButtonLink } from '@/components/ui/Button';
import { FullPageLoader } from '@/components/ui/FullPageLoader';
import { ErrorState } from '@/components/ui/StateViews';
import { AuthCard } from '@/features/auth/AuthCard';
import { ApiError } from '@/lib/api/apiError';
import { HOME_PATH } from '@/lib/paths';
import { newsletterApi } from './newsletterApi';
import { NewsletterArt } from './NewsletterArt';
import { NewsletterSignup } from './NewsletterSignup';

/** Target of the double opt-in link: `/newsletter/confirm?token=…`. Confirms on load (the link was asked for). */
export function NewsletterConfirmPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  // A query (not an effect + mutation) so the token is sent once, also in React's strict mode.
  const confirmation = useQuery({
    queryKey: ['newsletter-confirm', token],
    queryFn: () => newsletterApi.confirm(token),
    enabled: token !== '',
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  if (token && confirmation.isPending) {
    return <FullPageLoader label="Confirming your subscription…" />;
  }
  if (confirmation.isSuccess) {
    return (
      <AuthCard title="You are subscribed">
        <NewsletterArt kind="inbox" />
        <div className="flex flex-col items-center gap-5 text-center">
          <p className="leading-relaxed text-slate-700">
            We will send travel deals and news to <strong className="text-slate-900">{confirmation.data.email}</strong>. Every
            newsletter has a link to unsubscribe.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink to="/offers">See current offers</ButtonLink>
            <ButtonLink to={HOME_PATH} variant="secondary">Back to home</ButtonLink>
          </div>
        </div>
      </AuthCard>
    );
  }

  const error = confirmation.error ? ApiError.from(confirmation.error) : null;
  if (error && error.code !== 'INVALID_OR_EXPIRED_TOKEN' && error.status !== 400) {
    return (
      <PageContainer width="md">
        <ErrorState description={error.message} correlationId={error.correlationId} onRetry={() => void confirmation.refetch()} />
      </PageContainer>
    );
  }
  return (
    <AuthCard title="This link does not work" subtitle="Confirmation links work once and are valid for 48 hours.">
      <NewsletterArt kind="lost" />
      <p className="mb-3 text-sm text-slate-700">Enter your e-mail address and we will send you a new link.</p>
      <NewsletterSignup />
    </AuthCard>
  );
}
