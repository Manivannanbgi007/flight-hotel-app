import type { ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, LockKeyhole } from 'lucide-react';

import { LostIllustration } from '@/components/illustrations';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonStyles';
import { PasswordField } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { parsePortal, PORTALS, signInPath } from '@/lib/auth/portals';
import { AuthFootnote, AuthHeader, AuthShell } from './AuthShell';
import { accountStoryFor } from './authStories';
import { authApi } from './authApi';
import { PasswordChecklist } from './PasswordChecklist';
import { resetPasswordSchema, type ResetPasswordForm } from './schemas';
import { PORTAL_CONTENT } from './signin/portalContent';

/**
 * Target of the "reset your password" link (`/reset-password?token=...`) and of the staff invitation
 * (`&invite=1`, "set your password"). `&portal=ADMIN` (or admin, hotel-manager, ...) sends the user to that portal's
 * sign-in page afterwards; without it, the customer sign-in.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const invitation = params.get('invite') === '1';
  const portal = parsePortal(params.get('portal')) ?? 'CUSTOMER';

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const password = useWatch({ control, name: 'password' });

  const mutation = useMutation({
    mutationFn: (form: ResetPasswordForm) => authApi.resetPassword({ token, newPassword: form.password }),
    onSuccess: () => void navigate(signInPath(portal, { reason: invitation ? 'account-ready' : 'password-reset' }), { replace: true }),
    onError: (error) => {
      applyServerErrors(error, setError, ['password'], 'password');
    },
  });

  const shell = (content: ReactNode) => (
    <AuthShell roleClass={PORTAL_CONTENT[portal].roleClass} story={accountStoryFor(portal)}>
      {content}
    </AuthShell>
  );

  if (!token) {
    return shell(<InvalidLink invitation={invitation} signIn={PORTALS[portal].signInPath} />);
  }

  const error = mutation.error ? ApiError.from(mutation.error) : null;
  if (error?.code === 'INVALID_OR_EXPIRED_TOKEN') {
    return shell(<InvalidLink invitation={invitation} signIn={PORTALS[portal].signInPath} />);
  }

  return shell(
    <>
      <AuthHeader
        icon={<LockKeyhole className="size-6" />}
        title={invitation ? 'Set your password' : 'Choose a new password'}
        subtitle={
          invitation
            ? 'Welcome! Choose the password for your new account.'
            : 'After this, you will be logged out on all devices and can log in with the new password.'
        }
      />
      <form onSubmit={handleSubmit((form) => mutation.mutate(form))} noValidate className="mt-8 flex flex-col gap-5">
        {error && error.code !== 'WEAK_PASSWORD' && error.code !== 'VALIDATION_FAILED' && (
          <Alert tone="danger">{error.message}</Alert>
        )}
        <div className="flex flex-col gap-2">
          <PasswordField
            label="New password"
            icon={LockKeyhole}
            autoComplete="new-password"
            autoFocus
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordChecklist password={password} />
        </div>
        <PasswordField
          label="Repeat new password"
          icon={LockKeyhole}
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" size="lg" variant="role" loading={mutation.isPending}>
          {invitation ? 'Set password' : 'Change password'}
        </Button>
      </form>
    </>,
  );
}

function InvalidLink({ invitation, signIn }: { invitation: boolean; signIn: string }) {
  return (
    <>
      <AuthHeader center title="This link does not work" illustration={<LostIllustration className="w-36" />} />
      <div className="mt-6 flex flex-col gap-4">
        <Alert tone="warning">
          {invitation
            ? 'This invitation link is invalid, already used or older than 72 hours. Ask your administrator for a new invitation.'
            : 'This reset link is invalid, already used or older than 1 hour.'}
        </Alert>
        {!invitation && (
          <Link to="/forgot-password" className={buttonClass({ variant: 'role', size: 'lg' })}>
            Request a new link
          </Link>
        )}
      </div>
      <AuthFootnote>
        <Link to={signIn} className="inline-flex items-center justify-center gap-1.5 font-semibold text-role-700 hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to log in
        </Link>
      </AuthFootnote>
    </>
  );
}
