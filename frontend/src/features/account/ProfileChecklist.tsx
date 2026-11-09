import { CircleCheck, CircleDashed, PartyPopper } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { PROFILE_FIELD_IDS } from './profileFieldIds';
import type { Profile } from './types';

interface ChecklistItem {
  label: string;
  done: boolean;
  /** What "Add" does for a missing item; none for the e-mail (the link is in the customer's inbox). */
  add?: () => void;
}

/**
 * How complete the saved profile is: a ring that fills on arrival (`animate-ring-fill`, then a transition when the
 * profile changes) and the six items, each missing one with an "Add" that opens the photo picker or moves to its field.
 * Counts what is saved, not what is typed in the form.
 */
export function ProfileChecklist({ profile, onAddPhoto }: { profile: Profile; onAddPhoto: () => void }) {
  const items: ChecklistItem[] = [
    { label: 'Your name', done: true },
    { label: 'Verified e-mail', done: profile.emailVerified },
    { label: 'Profile photo', done: profile.hasPhoto, add: onAddPhoto },
    { label: 'Mobile number', done: !!profile.phone, add: () => goToField(PROFILE_FIELD_IDS.phone) },
    { label: 'Date of birth', done: !!profile.dateOfBirth, add: () => goToField(PROFILE_FIELD_IDS.dateOfBirth) },
    { label: 'Nationality', done: !!profile.nationality, add: () => goToField(PROFILE_FIELD_IDS.nationality) },
  ];
  const done = items.filter((item) => item.done).length;
  const percent = Math.round((done / items.length) * 100);
  const complete = done === items.length;

  return (
    <Card role="region" aria-labelledby="profile-checklist-title" className="flex min-w-0 flex-col p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <ProgressRing percent={percent} complete={complete} />
        <div className="min-w-0">
          <h2 id="profile-checklist-title" className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">Profile checklist</h2>
          <p className="mt-0.5 text-sm font-semibold text-slate-700">{done} of {items.length} done</p>
          <p className="mt-0.5 text-sm text-slate-600">
            {complete ? 'Your profile is complete.' : 'Add the rest whenever you like.'}
          </p>
        </div>
      </div>

      <ul className="mt-5 grid gap-1.5 sm:grid-cols-2">
        {items.map((item) => (
          <li
            key={item.label}
            className={cn(
              'flex min-h-10 items-center gap-2 rounded-xl py-1.5 pl-3 pr-2 text-sm ring-1 ring-inset transition-colors duration-(--duration-base)',
              item.done ? 'bg-success-50/60 text-slate-800 ring-success-100' : 'bg-white text-slate-700 ring-slate-200',
            )}
          >
            {item.done ? (
              <CircleCheck className="size-[1.125rem] shrink-0 text-success-600" aria-hidden="true" />
            ) : (
              <span aria-hidden="true" className="flex shrink-0 text-slate-400">
                <CircleDashed className="size-[1.125rem] text-current" />
              </span>
            )}
            <span className="min-w-0 flex-1 font-medium">
              <span className="sr-only">{item.done ? 'Done: ' : 'To do: '}</span>
              {item.label}
            </span>
            {!item.done && item.add && (
              <button
                type="button"
                onClick={item.add}
                aria-label={`Add ${item.label.toLowerCase()}`}
                className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-role-700 transition-colors hover:bg-role-50"
              >
                Add
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-4 text-xs leading-relaxed text-slate-500">Counts what is saved: new details count once you save them.</p>
    </Card>
  );
}

/** The ring (decorative: the text next to it says the same). Green with a small party popper when complete. */
function ProgressRing({ percent, complete }: { percent: number; complete: boolean }) {
  return (
    <span aria-hidden="true" className={cn('relative flex size-20 shrink-0 items-center justify-center', complete ? 'text-success-600' : 'text-role-600')}>
      <svg viewBox="0 0 80 80" className="absolute inset-0 size-full -rotate-90">
        <circle cx="40" cy="40" r="34" fill="none" strokeWidth="7" className={complete ? 'stroke-success-100' : 'stroke-role-100'} />
        <circle
          cx="40"
          cy="40"
          r="34"
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={100 - percent}
          className="stroke-current transition-[stroke-dashoffset] duration-(--duration-slower) ease-out-soft animate-ring-fill"
        />
      </svg>
      {complete ? (
        <PartyPopper className="size-7 text-current animate-pop [animation-delay:900ms]" />
      ) : (
        <span className="text-lg font-bold tabular-nums text-slate-900">{percent}%</span>
      )}
    </span>
  );
}

/** Moves to a field of the profile form and focuses it (smoothly, unless the customer asked for less motion). */
function goToField(id: string) {
  const field = document.getElementById(id);
  if (!field) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
  field.focus({ preventScroll: true });
  field.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
}
