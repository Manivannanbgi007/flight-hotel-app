import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, KeyRound, Mail, Send } from 'lucide-react';

import { EmptyInboxIllustration } from '@/components/illustrations';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/apiError';
import { parsePortal, PORTALS } from '@/lib/auth/portals';
import { AuthFootnote, AuthHeader, AuthShell } from './AuthShell';
import { accountStoryFor } from './authStories';
import { authApi } from './authApi';
import { emailOnlySchema, type EmailOnlyForm } from './schemas';
import { PORTAL_CONTENT } from './signin/portalContent';

/**
 * `/forgot-password` (`?portal=admin` etc. from a staff sign-in page, so "Back to log in" returns there and the page
 * wears that portal's colour).
 */
export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const portal = parsePortal(params.get('portal')) ?? 'CUSTOMER';
  const backTo = PORTALS[portal].signInPath;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailOnlyForm>({ resolver: zodResolver(emailOnlySchema), defaultValues: { email: '' } });
  const mutation = useMutation({ mutationFn: (form: EmailOnlyForm) => authApi.forgotPassword(form.email) });

  const backLink = (
    <Link to={backTo} className="inline-flex items-center gap-1.5 font-semibold text-role-700 hover:underline">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to log in
    </Link>
  );

  return (
    <AuthShell roleClass={PORTAL_CONTENT[portal].roleClass} story={accountStoryFor(portal)}>
      {mutation.isSuccess ? (
        <>
          <AuthHeader center title="Check your inbox" illustration={<EmptyInboxIllustration className="w-40" />} />
          <div className="mt-5 flex flex-col items-center gap-3 text-center">
            {/* The server's answer never says whether the account exists. */}
            <p className="text-slate-700">{mutation.data.message}</p>
            <p className="text-sm text-slate-600">The link is valid for 1 hour and can be used once.</p>
          </div>
          <AuthFootnote>{backLink}</AuthFootnote>
        </>
      ) : (
        <>
          <AuthHeader
            icon={<KeyRound className="size-6" />}
            title="Forgot your password?"
            subtitle="Enter the email address of your account and we will send you a link to choose a new password."
          />
          <form onSubmit={handleSubmit((form) => mutation.mutate(form))} noValidate className="mt-8 flex flex-col gap-5">
            {mutation.isError && <Alert tone="danger">{ApiError.from(mutation.error).message}</Alert>}
            <TextField
              label="Email"
              type="email"
              icon={Mail}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              error={errors.email?.message}
              {...register('email')}
            />
            <Button type="submit" size="lg" variant="role" loading={mutation.isPending}>
              <Send className="size-4" aria-hidden="true" />
              Send reset link
            </Button>
          </form>
          <AuthFootnote>{backLink}</AuthFootnote>
        </>
      )}
    </AuthShell>
  );
}
