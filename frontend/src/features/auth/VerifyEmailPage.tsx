import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, Mail } from 'lucide-react';

import { LostIllustration, PaymentSuccessIllustration } from '@/components/illustrations';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/buttonStyles';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { FullPageLoader } from '@/components/ui/FullPageLoader';
import { ApiError } from '@/lib/api/apiError';
import { AuthHeader, AuthShell } from './AuthShell';
import { ACCOUNT_STORY } from './authStories';
import { authApi } from './authApi';
import { emailOnlySchema, type EmailOnlyForm } from './schemas';

/** Target of the link in the verification email: `/verify-email?token=...`. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  // A query (not an effect + mutation) so the token is sent exactly once, also in React's strict mode.
  const verification = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => authApi.verifyEmail(token),
    enabled: token !== '',
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  if (token && verification.isPending) {
    return <FullPageLoader label="Confirming your email address…" />;
  }

  if (verification.isSuccess) {
    return (
      <AuthShell story={ACCOUNT_STORY}>
        <AuthHeader
          center
          title="Email confirmed"
          subtitle="Your account is ready. Log in to start planning your trip."
          illustration={<PaymentSuccessIllustration className="w-44" />}
        />
        <Link to="/customer/login?reason=verified" className={buttonClass({ size: 'lg', className: 'mt-8 w-full' })}>
          Log in
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </AuthShell>
    );
  }

  const error = verification.error ? ApiError.from(verification.error) : null;
  return (
    <AuthShell story={ACCOUNT_STORY}>
      <AuthHeader
        center
        title="This link does not work"
        subtitle="Verification links can be used once and are valid for 24 hours."
        illustration={<LostIllustration className="w-36" />}
      />
      <div className="mt-6">
        {error && error.code !== 'INVALID_OR_EXPIRED_TOKEN' && (
          <Alert tone="danger" className="mb-4">
            {error.message}
          </Alert>
        )}
        <ResendVerificationForm />
      </div>
    </AuthShell>
  );
}

function ResendVerificationForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailOnlyForm>({ resolver: zodResolver(emailOnlySchema), defaultValues: { email: '' } });
  const resend = useMutation({ mutationFn: (form: EmailOnlyForm) => authApi.resendVerification(form.email) });

  if (resend.isSuccess) {
    return <Alert tone="success">{resend.data.message}</Alert>;
  }
  return (
    <form onSubmit={handleSubmit((form) => resend.mutate(form))} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-slate-700">Enter your email address and we will send you a new link.</p>
      {resend.isError && <Alert tone="danger">{ApiError.from(resend.error).message}</Alert>}
      <TextField
        label="Email"
        type="email"
        icon={Mail}
        placeholder="you@example.com"
        autoComplete="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <Button type="submit" size="lg" loading={resend.isPending}>
        Send a new link
      </Button>
      <Link to="/customer/login" className="mt-2 inline-flex items-center justify-center gap-1.5 text-center text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to log in
      </Link>
    </form>
  );
}
