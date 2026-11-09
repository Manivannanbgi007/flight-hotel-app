import { Link } from 'react-router';
import { Mail, Phone, ShieldCheck, Sparkles, Zap } from 'lucide-react';

import { NewsletterSignup } from '@/features/newsletter/NewsletterSignup';
import { usePublicSettings } from '@/features/settings/usePublicSettings';
import { PORTALS } from '@/lib/auth/portals';
import { Logo } from './Logo';

const columns: { title: string; links: { to: string; label: string }[] }[] = [
  {
    title: 'Travel',
    links: [
      { to: '/flights', label: 'Search flights' },
      { to: '/hotels', label: 'Search hotels' },
      { to: '/offers', label: 'Deals and offers' },
      { to: '/my-trips', label: 'Manage bookings' },
    ],
  },
  {
    title: 'Company',
    links: [
      { to: '/about', label: 'About us' },
      { to: '/contact', label: 'Contact us' },
      { to: '/help', label: 'Help & Support' },
    ],
  },
  {
    title: 'Partners and staff',
    links: [
      { to: PORTALS.HOTEL_MANAGER.signInPath, label: 'Hotel partner sign-in' },
      { to: PORTALS.SUPPORT.signInPath, label: 'Support sign-in' },
      { to: PORTALS.ADMIN.signInPath, label: 'Admin sign-in' },
    ],
  },
];

/** What the product does (facts about features, never numbers). */
const promises = [
  { icon: ShieldCheck, text: 'Secure payments' },
  { icon: Zap, text: 'Live booking updates' },
  { icon: Sparkles, text: 'Flights and hotels in one place' },
];

/** The site footer: brand and support contacts (from the site settings), link columns, newsletter, copyright. */
export function SiteFooter() {
  const { settings } = usePublicSettings();
  const year = new Date().getFullYear();
  return (
    <footer className="relative mt-auto overflow-hidden border-t border-slate-200 bg-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-mesh opacity-70" />
      <div className="relative mx-auto max-w-7xl px-4 pb-8 pt-12 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_2fr]">
          <div className="flex flex-col gap-4">
            <Logo name={settings.siteName} />
            <p className="max-w-sm text-sm leading-relaxed text-slate-600">Flights and hotels, booked with confidence.</p>
            <div className="flex flex-col gap-2 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Customer support</p>
              {settings.supportEmail && (
                <p className="flex items-center gap-2">
                  <Mail className="size-4 text-brand-600" aria-hidden="true" />
                  <a className="font-medium hover:text-brand-700 hover:underline" href={`mailto:${settings.supportEmail}`}>
                    {settings.supportEmail}
                  </a>
                </p>
              )}
              {settings.supportPhone && (
                <p className="flex items-center gap-2">
                  <Phone className="size-4 text-brand-600" aria-hidden="true" />
                  <span>{settings.supportPhone}</span>
                </p>
              )}
            </div>
          </div>

          <nav aria-label="Footer" className="grid gap-8 sm:grid-cols-3">
              {columns.map((column) => (
                <div key={column.title}>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{column.title}</p>
                  <ul className="mt-3 flex flex-col gap-2 text-sm">
                    {column.links.map((link) => (
                      <li key={link.to}>
                        <Link className="text-slate-700 transition-colors hover:text-brand-700" to={link.to}>{link.label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </nav>
        </div>

        <section
          aria-labelledby="footer-newsletter"
          className="mt-10 grid gap-4 rounded-3xl bg-gradient-ocean p-6 text-white shadow-xl sm:p-8 lg:grid-cols-[1fr_1.1fr] lg:items-center"
        >
          <div>
            <p id="footer-newsletter" className="text-lg font-bold">Newsletter</p>
            <p className="mt-1 text-sm text-brand-100">Travel deals and news, now and then. Unsubscribe at any time.</p>
          </div>
          <div className="rounded-2xl bg-white p-4 text-slate-900 shadow-lg">
            <NewsletterSignup className="max-w-none" />
          </div>
        </section>

        {/* Right padding: the end of the page stays clear of the AI assistant's floating button (bottom-right). */}
        <div className="mt-8 flex flex-col-reverse gap-4 border-t border-slate-100 pr-18 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:pr-20">
          <p>© {year} {settings.siteName}</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Why book with us">
            {promises.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-1.5">
                <Icon className="size-4 text-brand-600" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
