import { Link } from 'react-router';
import { Mail, MessageSquarePlus, Phone, Ticket } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { usePublicSettings } from '@/features/settings/usePublicSettings';
import { cn } from '@/lib/cn';
import { loginPath } from '@/lib/auth/redirects';

const NEW_TICKET = '/account/support/new';

/**
 * "Create a support ticket" (login required) and the support e-mail and phone from the public settings.
 * `layout="grid"` puts the two cards side by side (contact page); the default stacks them (help sidebar).
 */
export function SupportOptions({ headingLevel = 2, layout = 'stack' }: { headingLevel?: 2 | 3; layout?: 'stack' | 'grid' }) {
  const { user } = useAuth();
  const { settings } = usePublicSettings();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const hasContacts = Boolean(settings.supportEmail || settings.supportPhone);

  return (
    <div className={cn('grid gap-4', layout === 'grid' && hasContacts && 'md:grid-cols-2')}>
      <Card className="relative overflow-hidden p-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-brand-50" />
        <span aria-hidden="true" className="relative flex size-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-glow">
          <Ticket className="size-5" />
        </span>
        <Heading className="relative mt-4 text-base font-bold text-slate-900">Still need help?</Heading>
        <p className="relative mt-1 text-sm leading-relaxed text-slate-600">
          A support ticket is the fastest way: our team sees your booking and answers in your account.
        </p>
        {user ? (
          <div className="relative mt-4 flex flex-col gap-2">
            <ButtonLink to={NEW_TICKET} className="w-full">
              <MessageSquarePlus className="size-4" aria-hidden="true" /> Create a support ticket
            </ButtonLink>
            <ButtonLink to="/account/support" variant="secondary" className="w-full">My support tickets</ButtonLink>
          </div>
        ) : (
          <div className="relative mt-4 flex flex-col gap-2">
            <ButtonLink to={loginPath(NEW_TICKET)} className="w-full">
              <MessageSquarePlus className="size-4" aria-hidden="true" /> Log in to create a support ticket
            </ButtonLink>
            <p className="text-center text-xs text-slate-600">
              No account? <Link to="/register" className="font-semibold text-brand-700 hover:underline">Register</Link>
            </p>
          </div>
        )}
      </Card>

      {hasContacts && (
        <Card className="p-6">
          <Heading className="text-base font-bold text-slate-900">Contact details</Heading>
          <ul className="mt-3 flex flex-col gap-3 text-sm text-slate-700">
            {settings.supportEmail && (
              <li className="flex items-center gap-3">
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700 ring-1 ring-accent-100">
                  <Mail className="size-4" />
                </span>
                <span className="sr-only">E-mail: </span>
                <a href={`mailto:${settings.supportEmail}`} className="min-w-0 break-all font-semibold text-brand-700 hover:underline">{settings.supportEmail}</a>
              </li>
            )}
            {settings.supportPhone && (
              <li className="flex items-center gap-3">
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-700 ring-1 ring-success-100">
                  <Phone className="size-4" />
                </span>
                <span className="sr-only">Phone: </span>
                <a href={`tel:${settings.supportPhone.replace(/[^\d+]/g, '')}`} className="font-semibold text-brand-700 hover:underline">{settings.supportPhone}</a>
              </li>
            )}
          </ul>
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            For questions about a booking, please give us the booking reference.
          </p>
        </Card>
      )}
    </div>
  );
}
