import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { BadgeCheck } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { PageContainer } from '@/components/layout/PageContainer';
import { Avatar } from './Avatar';

/**
 * "My account" pages: a banner with the signed-in user (avatar, name, verified) above the open section. The sections'
 * navigation is the customer area's sidebar (CustomerAreaLayout, around this layout). Lazy-loaded; RequireAuth in the
 * router makes sure someone is logged in.
 */
export function AccountLayout() {
  const { user } = useAuth();
  return (
    <PageContainer width="xl">
      <header className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card animate-fade-up sm:p-6">
        {/* A quiet brand edge on the left. */}
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-[linear-gradient(180deg,var(--color-brand-500),var(--color-brand-700))]" />
        <div className="flex items-start gap-4 sm:items-center sm:gap-5">
          {user && <Avatar user={user} size="header" className="ring-4 ring-brand-50" />}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">My account</h1>
            <p className="mt-1 text-sm text-slate-600">
              {user && <span className="font-semibold text-slate-900">{user.firstName} {user.lastName} · </span>}
              Your profile, travellers, payments, messages and settings.
            </p>
            {user?.emailVerified && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success-50 px-3 py-1 text-xs font-semibold text-success-700 ring-1 ring-success-200">
                <BadgeCheck className="size-4 text-success-600" aria-hidden="true" />
                Verified account
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="mt-6 min-w-0 animate-fade-in">
        <Outlet />
      </div>
    </PageContainer>
  );
}

/** Heading + description at the top of each account section (or of a card inside it). `id` names the heading. */
export function SectionHeader({ title, description, action, id }: {
  title: string;
  description?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
