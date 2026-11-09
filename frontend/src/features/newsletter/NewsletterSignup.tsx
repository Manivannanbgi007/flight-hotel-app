import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Mail, Send } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { controlClass } from '@/components/ui/fieldStyles';
import { emailOnlySchema, type EmailOnlyForm } from '@/features/auth/schemas';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { cn } from '@/lib/cn';
import { newsletterApi } from './newsletterApi';

/** The same words for every address, so the page never tells whether an address is already subscribed. */
export const SUBSCRIBE_DONE_TEXT =
  'Thanks! Please check your inbox: if this address is not subscribed yet, we have sent you a link to confirm it.';

/** Newsletter sign-up (footer and the confirmation page). Public; the confirmation link in the e-mail completes it. */
export function NewsletterSignup({ className }: { className?: string }) {
  const emailId = useId();
  const errorId = useId();
  const [shownOnField, setShownOnField] = useState(false);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<EmailOnlyForm>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: '' },
  });
  const subscribe = useMutation({
    mutationFn: (form: EmailOnlyForm) => newsletterApi.subscribe(form.email),
    onMutate: () => setShownOnField(false),
    onError: (error) => setShownOnField(applyServerErrors(error, setError, ['email'])),
  });

  if (subscribe.isSuccess) {
    return (
      <p role="status" className={cn('flex items-start gap-2.5 rounded-xl bg-success-50 p-3 text-sm text-success-700 ring-1 ring-inset ring-success-200 animate-scale-in', className)}>
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        {SUBSCRIBE_DONE_TEXT}
      </p>
    );
  }
  const problem = subscribe.error && !shownOnField ? ApiError.from(subscribe.error) : null;
  const fieldError = errors.email?.message;

  return (
    <form aria-label="Newsletter" noValidate className={cn('@container flex flex-col gap-2', className)}
      onSubmit={handleSubmit((form) => subscribe.mutate(form))}>
      <label htmlFor={emailId} className="text-sm font-semibold text-slate-800">Your e-mail address</label>
      {/* Side by side when the form is wide enough (container query), stacked in a narrow footer box on phones. */}
      <div className="flex flex-col gap-2 @xs:flex-row">
        <div className="relative min-w-0 flex-1">
          <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? errorId : undefined}
            className={cn(controlClass(!!fieldError), 'pl-10')}
            {...register('email')}
          />
        </div>
        <Button type="submit" loading={subscribe.isPending}>
          {!subscribe.isPending && <Send className="size-4" aria-hidden="true" />}
          Subscribe
        </Button>
      </div>
      {fieldError && (
        <p id={errorId} className="flex items-center gap-1.5 text-sm text-danger-600">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          {fieldError}
        </p>
      )}
      {problem && <p role="alert" className="text-sm text-danger-600">{problem.message}</p>}
    </form>
  );
}
