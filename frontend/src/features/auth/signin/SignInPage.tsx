import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { format } from 'date-fns';
import { ArrowRight, LockKeyhole, Mail } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonStyles';
import { CheckboxField, PasswordField, TextField } from '@/components/ui/Field';
import { usePublicSettings } from '@/features/settings/usePublicSettings';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { canUsePortal, parsePortal, PORTAL_ORDER, PORTALS, primaryPortal, signInPath, type Portal } from '@/lib/auth/portals';
import { canOpenPath, safeRedirect } from '@/lib/auth/redirects';
import type { AuthUser } from '@/lib/auth/types';
import { authApi } from '../authApi';
import { AuthHeader, AuthShell } from '../AuthShell';
import { loginSchema, type LoginForm } from '../schemas';
import { DevAccountsPanel } from './DevAccountsPanel';
import { PORTAL_CONTENT } from './portalContent';

/** Messages for `?reason=...` (set by other pages and e-mail links when they send the user here). */
const REASONS: Record<string, { tone: 'info' | 'success' | 'warning'; text: string }> = {
  'session-ended': {
    tone: 'warning',
    text: 'You were logged out because your session was ended (for example after a password change or "log out everywhere"). Please log in again.',
  },
  'logged-out-everywhere': { tone: 'success', text: 'You have been logged out on all devices.' },
  'account-deactivated': {
    tone: 'warning',
    text: 'Your account has been deactivated, so you were logged out. Please contact support if you think this is a mistake.',
  },
  verified: { tone: 'success', text: 'Your email address is confirmed. You can log in now.' },
  'password-reset': { tone: 'success', text: 'Your password has been changed. Log in with your new password.' },
  'account-ready': { tone: 'success', text: 'Your password is set. Log in to start using your account.' },
};

/** The code of a login the account may not use on this page (the server's answer, or the UI's own role check). */
const PORTAL_NOT_ALLOWED = 'PORTAL_NOT_ALLOWED';

/**
 * One sign-in page per portal (IMPLEMENTATION_PLAN.md §11.2), in the shared `AuthShell`: the form on one side, the
 * portal's illustration and what it offers on the other (left out on phones). The login request names the portal; an account without a matching role
 * gets "this account can't sign in here" with a link to its own sign-in page, from the server (403
 * PORTAL_NOT_ALLOWED) or, should the server let it through, from the role check after login (the session is then
 * ended again at once). After login: `?redirect=` when it is safe and the account may open it, else the portal's start.
 */
export function SignInPage({ portal }: { portal: Portal }) {
  const { status, user, login, signingOut } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { settings } = usePublicSettings();
  const info = PORTALS[portal];
  const content = PORTAL_CONTENT[portal];
  const reason = REASONS[params.get('reason') ?? ''];
  const redirect = safeRedirect(params.get('redirect'));
  const [resent, setResent] = useState(false);

  useEffect(() => {
    const previous = document.title;
    document.title = `${content.heading} · ${settings.siteName}`;
    return () => {
      document.title = previous;
    };
  }, [content.heading, settings.siteName]);

  const destinationFor = (account: Pick<AuthUser, 'roles'>) =>
    redirect && canOpenPath(account, redirect) ? redirect : info.home;

  const {
    register,
    handleSubmit,
    setError,
    getValues,
    setValue,
    clearErrors,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: params.get('email') ?? '', password: '', rememberMe: false },
  });

  const loginMutation = useMutation({
    mutationFn: async (form: LoginForm) => {
      const response = await authApi.login({ ...form, portal });
      if (!canUsePortal(response.user, portal)) {
        // The server let the login through (it may not know `portal` yet): end that session again, never keep it.
        await authApi.logout(response.accessToken).catch(() => undefined);
        throw new ApiError(403, PORTAL_NOT_ALLOWED, 'This account cannot sign in here.', [], null, {
          suggestedPortal: primaryPortal(response.user),
        });
      }
      return response;
    },
    onSuccess: (response) => {
      login(response);
      void navigate(destinationFor(response.user), { replace: true });
    },
    onError: (error) => {
      applyServerErrors(error, setError, ['email', 'password']);
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => authApi.resendVerification(getValues('email')),
    onSuccess: () => setResent(true),
  });

  // Already logged in with an account that belongs here: straight on.
  if (status === 'authenticated' && user && !signingOut && canUsePortal(user, portal) && !loginMutation.isPending) {
    return <Navigate to={destinationFor(user)} replace />;
  }

  const onSubmit = handleSubmit((form) => {
    setResent(false);
    loginMutation.mutate(form);
  });

  const error = loginMutation.error ? ApiError.from(loginMutation.error) : null;
  const Icon = content.icon;
  const forgotPath = portal === 'CUSTOMER' ? '/forgot-password' : `/forgot-password?portal=${info.area}`;
  const others = PORTAL_ORDER.filter((other) => other !== portal);
  const story = { title: content.storyTitle, text: content.storyText, points: content.points, Illustration: content.Illustration };

  return (
    <AuthShell roleClass={content.roleClass} story={story}>
      <AuthHeader
        badge={<><Icon className="size-3.5" aria-hidden="true" />{info.label}</>}
        title={content.heading}
        subtitle={content.subtitle(settings.siteName)}
      />

      <form id="signin-form" onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
        {status === 'authenticated' && user && !signingOut && (
          <Alert tone="info">
            You are logged in as {user.firstName} {user.lastName}. Logging in here with another account switches to that account.
          </Alert>
        )}
        {reason && !error && <Alert tone={reason.tone}>{reason.text}</Alert>}
        {error && (
          <LoginError
            error={error}
            portal={portal}
            onResend={() => resendMutation.mutate()}
            resending={resendMutation.isPending}
            resent={resent}
          />
        )}

        <TextField
          label="Email"
          type="email"
          icon={Mail}
          placeholder="you@example.com"
          autoComplete="username"
          autoFocus
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordField
          label="Password"
          icon={LockKeyhole}
          placeholder="Your password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CheckboxField label="Keep me logged in for 30 days" {...register('rememberMe')} />
          <Link to={forgotPath} className="shrink-0 text-sm font-semibold text-role-700 hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" variant="role" loading={loginMutation.isPending} className="mt-1 w-full">
          Log in
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </form>

      {portal === 'CUSTOMER' && (
        <>
          <p className="mt-7 flex items-center gap-3 text-xs font-medium text-slate-500">
            <span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
            New to {settings.siteName}?
            <span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
          </p>
          <Link
            to={`/register${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
            className={buttonClass({ variant: 'secondary', size: 'lg', className: 'mt-4 w-full' })}
          >
            Create an account
          </Link>
        </>
      )}

      <DevAccountsPanel
        portal={portal}
        onUse={({ email, password }) => {
          // Fills the form only; the person presses Log in.
          setValue('email', email, { shouldDirty: true });
          setValue('password', password, { shouldDirty: true });
          clearErrors();
          loginMutation.reset();
        }}
      />

      <nav aria-label="Other sign-in pages" className="mt-8 border-t border-slate-200 pt-5">
        <p className="text-xs font-semibold text-slate-500">Other sign-in pages</p>
        <ul className="mt-2.5 flex flex-col gap-1.5 text-sm">
          {others.map((other) => (
            <li key={other} className="flex flex-wrap gap-x-1.5">
              <span className="text-slate-600">{PORTALS[other].question}</span>{' '}
              <Link to={PORTALS[other].signInPath} className="font-semibold text-brand-700 hover:underline">
                {PORTALS[other].signInLabel}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </AuthShell>
  );
}

function LoginError({ error, portal, onResend, resending, resent }: {
  error: ApiError;
  portal: Portal;
  onResend: () => void;
  resending: boolean;
  resent: boolean;
}) {
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return <Alert tone="danger">Wrong email or password.</Alert>;
    case PORTAL_NOT_ALLOWED:
      return <WrongPortal portal={portal} suggested={suggestedPortal(error.details, portal)} />;
    case 'EMAIL_NOT_VERIFIED':
      return (
        <Alert tone="warning" title="Please confirm your email address first">
          {resent ? (
            <p>We have sent a new verification link. Check your inbox (and the spam folder).</p>
          ) : (
            <p>
              Open the link we emailed you.{' '}
              <button type="button" onClick={onResend} disabled={resending} className="font-semibold underline">
                {resending ? 'Sending…' : 'Send the link again'}
              </button>
            </p>
          )}
        </Alert>
      );
    case 'ACCOUNT_LOCKED': {
      const until = typeof error.details.lockedUntil === 'string' ? new Date(error.details.lockedUntil) : null;
      return (
        <Alert tone="danger" title="Account temporarily locked">
          Too many failed attempts.{' '}
          {until ? `Try again after ${format(until, 'HH:mm')}, or reset your password.` : 'Try again later, or reset your password.'}
        </Alert>
      );
    }
    case 'VALIDATION_FAILED':
      return null;
    default:
      return (
        <Alert tone="danger">
          {error.message}
          {error.status >= 500 && error.correlationId && (
            <span className="mt-1 block text-xs">Support reference: {error.correlationId}</span>
          )}
        </Alert>
      );
  }
}

/**
 * The page to point to after a refusal. identity-service sends `details.portals` (the portals this account may use, in
 * the order CUSTOMER, ADMIN, HOTEL_MANAGER, SUPPORT); the client's own role check sends `suggestedPortal`.
 */
function suggestedPortal(details: Record<string, unknown>, current: Portal): Portal | null {
  if (Array.isArray(details.portals)) {
    return details.portals.map((value) => parsePortal(String(value))).find((p): p is Portal => p !== null && p !== current) ?? null;
  }
  return parsePortal(String(details.suggestedPortal ?? details.portal ?? ''));
}

/** "This account can't sign in here": whom the page is for, and the way to the right sign-in page. */
function WrongPortal({ portal, suggested }: { portal: Portal; suggested: Portal | null }) {
  const right = suggested && suggested !== portal ? suggested : null;
  return (
    <Alert tone="warning" title="This account can't sign in here">
      <p>This sign-in page is for {PORTALS[portal].audience}.</p>
      {right ? (
        <p className="mt-1">
          Please use the right page for your account:{' '}
          <Link to={signInPath(right)} className="font-semibold underline">{PORTALS[right].signInLabel}</Link>
        </p>
      ) : (
        <>
          <p className="mt-1">Please use the sign-in page for your account:</p>
          <ul className="mt-1 list-disc pl-5">
            {PORTAL_ORDER.filter((other) => other !== portal).map((other) => (
              <li key={other}>
                <Link to={PORTALS[other].signInPath} className="font-semibold underline">{PORTALS[other].signInLabel}</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Alert>
  );
}
