import { Link } from 'react-router';
import { Home, LifeBuoy } from 'lucide-react';

import { LostIllustration } from '@/components/illustrations';
import { MinimalFrame } from '@/components/layout/MinimalFrame';
import { buttonClass } from '@/components/ui/buttonStyles';
import { HOME_PATH } from '@/lib/paths';

/** Unknown address: a friendly "lost" scene, home and help. */
export function NotFoundPage() {
  return (
    <MinimalFrame>
      <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center sm:py-20">
        <LostIllustration className="w-60 animate-fade-in sm:w-72" />
        <p className="mt-6 text-sm font-bold tracking-wider text-brand-700">404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Page not found</h1>
        <p className="mt-3 leading-relaxed text-slate-600">The page you are looking for does not exist or has moved.</p>
        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Link to={HOME_PATH} className={buttonClass({ size: 'lg' })}>
            <Home className="size-5" aria-hidden="true" />
            Go to home
          </Link>
          <Link to="/help" className={buttonClass({ variant: 'secondary', size: 'lg' })}>
            <LifeBuoy className="size-5" aria-hidden="true" />
            Get help
          </Link>
        </div>
      </section>
    </MinimalFrame>
  );
}
