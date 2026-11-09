import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight, LockKeyhole, Mail, Phone, UserPlus, UserRound } from 'lucide-react';

import { EmptyInboxIllustration } from '@/components/illustrations';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CheckboxField, PasswordField, TextField } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { AuthFootnote, AuthHeader, AuthShell } from './AuthShell';
import { REGISTER_STORY } from './authStories';
import { authApi } from './authApi';
import { PasswordChecklist } from './PasswordChecklist';
import { normalizePhone, registerSchema, type RegisterForm } from './schemas';

export function RegisterPage() {
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '', acceptTerms: false },
  });
  const [password, email] = useWatch({ control, name: ['password', 'email'] });

  const mutation = useMutation({
    mutationFn: (form: RegisterForm) =>
      authApi.register({
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: normalizePhone(form.phone),
        acceptTerms: form.acceptTerms,
      }),
    onSuccess: (_response, form) => setRegisteredEmail(form.email),
    onError: (error) => {
      applyServerErrors(error, setError, ['firstName', 'lastName', 'email', 'phone', 'password', 'acceptTerms'], 'password');
    },
  });

  if (registeredEmail) {
    return <CheckYourInbox email={registeredEmail} />;
  }

  const error = mutation.error ? ApiError.from(mutation.error) : null;
  const showBanner = error && error.code !== 'VALIDATION_FAILED' && error.code !== 'WEAK_PASSWORD';

  return (
    <AuthShell story={REGISTER_STORY} wide>
      <AuthHeader
        icon={<UserPlus className="size-6" />}
        title="Create your account"
        subtitle="Book flights and hotels, save travellers and follow every booking live."
      />
      <form onSubmit={handleSubmit((form) => mutation.mutate(form))} noValidate className="mt-8 flex flex-col gap-4">
        {showBanner && <Alert tone="danger">{error.message}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="First name" icon={UserRound} autoComplete="given-name" autoFocus error={errors.firstName?.message} {...register('firstName')} />
          <TextField label="Last name" autoComplete="family-name" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <TextField
          label="Email"
          type="email"
          icon={Mail}
          placeholder="you@example.com"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Mobile number"
          optional
          type="tel"
          icon={Phone}
          autoComplete="tel"
          placeholder="+91 98765 43210"
          hint="For booking updates and urgent changes to your trip."
          error={errors.phone?.message}
          {...register('phone')}
        />
        <div className="flex flex-col gap-2">
          <PasswordField label="Password" icon={LockKeyhole} autoComplete="new-password" error={errors.password?.message} {...register('password')} />
          <PasswordChecklist password={password} email={email} />
        </div>
        <PasswordField
          label="Repeat password"
          icon={LockKeyhole}
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <CheckboxField
          label={
            <>
              I accept the <Link to="/help" className="text-brand-700 underline">terms of use</Link> and the{' '}
              <Link to="/help" className="text-brand-700 underline">privacy policy</Link>.
            </>
          }
          error={errors.acceptTerms?.message}
          {...register('acceptTerms')}
        />

        <Button type="submit" size="lg" loading={mutation.isPending} className="mt-1">
          Create account
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </form>
      <AuthFootnote>
        Already have an account?{' '}
        <Link to="/customer/login" className="font-semibold text-brand-700 hover:underline">
          Log in
        </Link>
      </AuthFootnote>
    </AuthShell>
  );
}

function CheckYourInbox({ email }: { email: string }) {
  const resend = useMutation({ mutationFn: () => authApi.resendVerification(email) });

  return (
    <AuthShell story={REGISTER_STORY}>
      <AuthHeader center title="Check your inbox" illustration={<EmptyInboxIllustration className="w-40" />} />
      <div className="mt-5 flex flex-col items-center gap-4 text-center">
        <p className="text-slate-700">
          If <strong className="break-all">{email}</strong> can be used, we have sent a link to confirm it. The link is valid
          for 24 hours.
        </p>
        <p className="text-sm text-slate-600">Nothing arrived after a few minutes? Check the spam folder or send it again.</p>
        {resend.isSuccess ? (
          <Alert tone="success">We have sent a new link.</Alert>
        ) : (
          <Button variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>
            Send the link again
          </Button>
        )}
        {resend.isError && <Alert tone="danger">{ApiError.from(resend.error).message}</Alert>}
        <Link to="/customer/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to log in
        </Link>
      </div>
    </AuthShell>
  );
}
