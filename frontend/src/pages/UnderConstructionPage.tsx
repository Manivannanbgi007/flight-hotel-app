import { Link } from 'react-router';

import { SuitcaseIllustration } from '@/components/illustrations';
import { HOME_PATH } from '@/lib/paths';

/**
 * Honest placeholder for sections that are not built yet (see IMPLEMENTATION_PLAN.md).
 * It never shows sample data pretending to be real.
 */
export function UnderConstructionPage({ title, phase }: { title: string; phase: string }) {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center px-4 py-16 text-center">
      <SuitcaseIllustration className="w-40 animate-fade-in" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-2 text-slate-600">This section is being built and will be available in {phase}.</p>
      <Link to={HOME_PATH} className="mt-6 font-semibold text-brand-700 hover:underline">
        Back to home
      </Link>
    </section>
  );
}
