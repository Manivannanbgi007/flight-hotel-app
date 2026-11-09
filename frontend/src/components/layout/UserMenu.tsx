import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Bell, ChevronDown, CreditCard, Headset, Hotel, LayoutDashboard, LifeBuoy, LogOut, Luggage, Settings, SlidersHorizontal, Shield, ShieldCheck, User,
} from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { Skeleton } from '@/components/ui/Skeleton';
import { Avatar } from '@/features/account/Avatar';
import { PORTALS, portalLinks } from '@/lib/auth/portals';
import { primaryRoleLabel } from '@/lib/auth/roleLabels';
import { cn } from '@/lib/cn';

const portalIcons: Record<string, ReactNode> = {
  '/admin': <ShieldCheck className="size-4" />,
  '/hotel-manager': <Hotel className="size-4" />,
  '/support': <Headset className="size-4" />,
};

/**
 * Header area: "Login / Register" for visitors, the account menu for logged-in users. The button shows the avatar and,
 * on wide screens, the name and role. The menu: who is signed in (name, e-mail, role), the pages that fit the role
 * (a customer's trips and payments; everyone's profile and settings; an admin's system settings), the work portals the
 * user may open, and "Log out".
 */
export function UserMenu({ align = 'right' }: { align?: 'right' | 'left' }) {
  const { status, user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (status === 'loading') {
    return <Skeleton className="h-9 w-28 rounded-full" />;
  }
  if (!user) {
    return (
      <Link
        to={PORTALS.CUSTOMER.signInPath}
        className="hidden rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-brand-700 hover:shadow-glow sm:inline-block"
      >
        Login / Register
      </Link>
    );
  }

  const close = () => setOpen(false);
  const onLogout = async () => {
    setLoggingOut(true);
    close();
    await logout();
    setLoggingOut(false);
  };
  const isCustomer = user.roles.includes('CUSTOMER');
  const role = primaryRoleLabel(user.roles);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={menuId}
        className={cn(
          'flex items-center gap-2.5 rounded-full p-1 pr-2 ring-1 transition-[background-color,box-shadow] duration-(--duration-fast) ease-out-soft',
          open ? 'bg-white ring-slate-300 shadow-sm' : 'ring-transparent hover:bg-white hover:ring-slate-200',
        )}
        disabled={loggingOut}
      >
        {/* The name is the screen-reader text, which contains the visible first name (WCAG 2.5.3 "label in name").
            Not an aria-label: the avatar's initials count as visible text, and no aria-label would contain them. */}
        <Avatar user={user} />
        <span aria-hidden="true" className="hidden min-w-0 flex-col text-left leading-tight lg:flex">
          <span className="max-w-36 truncate text-sm font-semibold text-slate-800">{user.firstName}</span>
          <span className="max-w-36 truncate text-[0.6875rem] font-medium text-slate-500">{role}</span>
        </span>
        <span className="sr-only">Account menu for {user.firstName} {user.lastName}</span>
        <ChevronDown className={cn('size-4 text-slate-500 transition-transform duration-(--duration-base) ease-out-soft', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          className={cn(
            'absolute z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl ring-1 ring-slate-900/5 animate-scale-in',
            align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left',
          )}
        >
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3.5">
            <Avatar user={user} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">
                {user.firstName} {user.lastName}
              </p>
              <p className="truncate text-xs text-slate-600">{user.email}</p>
              <p className="mt-1.5 inline-flex items-center rounded-full bg-role-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-role-700 ring-1 ring-role-100">
                {role}
              </p>
            </div>
          </div>
          <nav aria-label="Account" className="p-1.5">
            {isCustomer && (
              <>
                <MenuLink to={PORTALS.CUSTOMER.home} icon={<LayoutDashboard className="size-4" />} label="My dashboard" onClick={close} />
                <MenuLink to="/my-trips" icon={<Luggage className="size-4" />} label="My Trips" onClick={close} />
                <MenuLink to="/account/payments" icon={<CreditCard className="size-4" />} label="Payment history" onClick={close} />
                <MenuLink to="/account/support" icon={<LifeBuoy className="size-4" />} label="Support tickets" onClick={close} />
                <div className="my-1.5 h-px bg-slate-100" />
              </>
            )}
            <MenuLink to="/account/profile" icon={<User className="size-4" />} label="My profile" onClick={close} />
            {isCustomer ? (
              <>
                <MenuLink to="/account/notifications" icon={<Bell className="size-4" />} label="Notifications" onClick={close} />
                <MenuLink to="/account/preferences" icon={<SlidersHorizontal className="size-4" />} label="Preferences" onClick={close} />
                <MenuLink to="/account/security" icon={<Shield className="size-4" />} label="Security" onClick={close} />
              </>
            ) : (
              <MenuLink to="/account/security" icon={<SlidersHorizontal className="size-4" />} label="Settings" onClick={close} />
            )}
            {user.roles.includes('ADMIN') && (
              <MenuLink to="/admin/settings" icon={<Settings className="size-4" />} label="System settings" onClick={close} />
            )}
            {portalLinks(user).length > 0 && (
              <div className="mt-1.5 border-t border-slate-100 pt-1.5">
                <p className="px-3 pb-1 pt-1 text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500">Work portals</p>
                {portalLinks(user).map((link) => (
                  <MenuLink key={link.to} to={link.to} icon={portalIcons[link.to]} label={link.label} onClick={close} />
                ))}
              </div>
            )}
          </nav>
          <div className="border-t border-slate-100 p-1.5">
            <button
              type="button"
              onClick={() => void onLogout()}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-danger-50 hover:text-danger-700"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({ to, label, icon, onClick }: { to: string; label: string; icon?: ReactNode; onClick: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-(--duration-fast) hover:bg-slate-100 hover:text-slate-900"
    >
      <span aria-hidden="true" className="text-slate-400 transition-colors group-hover:text-role-600">{icon ?? <span className="block size-4" />}</span>
      {label}
    </Link>
  );
}
