import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { Alert } from '@/components/ui/Alert';
import { Button, ButtonLink } from '@/components/ui/Button';
import { AuthCard } from '@/features/auth/AuthCard';
import { ApiError } from '@/lib/api/apiError';
import { HOME_PATH } from '@/lib/paths';
import { newsletterApi } from './newsletterApi';
import { NewsletterArt } from './NewsletterArt';

/**
 * Target of the link in every newsletter: `/newsletter/unsubscribe?token=…`. Nothing happens until the button is
 * pressed, so e-mail link scanners that open the link cannot unsubscribe anyone.
 */
export function NewsletterUnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const unsubscribe = useMutation({ mutationFn: () => newsletterApi.unsubscribe(token) });
  const error = unsubscribe.error ? ApiError.from(unsubscribe.error) : null;

  if (unsubscribe.isSuccess) {
    return (
      <AuthCard title="You are unsubscribed">
        <NewsletterArt kind="inbox" />
        <div className="flex flex-col items-center gap-5 text-center">
          <p className="leading-relaxed text-slate-700">You will not get our newsletter any more. E-mails about your bookings still arrive as usual.</p>
          <ButtonLink to={HOME_PATH} variant="secondary">Back to home</ButtonLink>
        </div>
      </AuthCard>
    );
  }
  if (!token || error?.code === 'INVALID_TOKEN' || error?.status === 400) {
    return (
      <AuthCard title="This link does not work" subtitle="Please use the unsubscribe link from one of our newsletters.">
        <NewsletterArt kind="lost" />
        <p className="text-sm leading-relaxed text-slate-700">
          Logged in? You can also turn the newsletter off in your{' '}
          <Link to="/account/notifications/settings" className="font-semibold text-brand-700 hover:underline">notification settings</Link>.
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Unsubscribe from the newsletter?" subtitle="You will stop getting our travel deals and news. E-mails about your bookings are not affected.">
      <NewsletterArt kind="inbox" />
      <div className="flex flex-col gap-3">
        {error && (
          <Alert tone="danger">
            {error.message}
            {error.correlationId && <span className="block text-xs">Support reference: {error.correlationId}</span>}
          </Alert>
        )}
        <Button onClick={() => unsubscribe.mutate()} loading={unsubscribe.isPending} className="w-full">Unsubscribe</Button>
        <ButtonLink to={HOME_PATH} variant="ghost" className="w-full">Keep me subscribed</ButtonLink>
      </div>
    </AuthCard>
  );
}
