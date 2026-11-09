import { useId, type ChangeEvent, type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/app/providers/useAuth';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { accountApi } from './accountApi';
import { Avatar } from './Avatar';
import type { Profile } from './types';

const ACCEPTED = 'image/jpeg,image/png';
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * The profile photo: a drifting gradient band with a flight path, the photo (or initials) overlapping it, and the
 * upload/remove buttons. Clicking the photo also opens the file picker; keyboard users use the buttons (the file input
 * itself is out of the tab order, it has no visible focus). `inputRef` lets the profile checklist open the picker.
 */
export function ProfilePhotoCard({ profile, inputRef }: {
  profile: Profile;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const queryClient = useQueryClient();
  const { user, updateUser } = useAuth();
  const inputId = useId();

  const afterChange = (saved: Profile | null) => {
    if (saved) {
      queryClient.setQueryData(queryKeys.account.profile, saved);
    } else {
      void queryClient.invalidateQueries({ queryKey: queryKeys.account.profile });
    }
    queryClient.removeQueries({ queryKey: queryKeys.account.profilePhoto });
    updateUser({ hasPhoto: saved?.hasPhoto ?? false });
  };

  const upload = useMutation({
    mutationFn: accountApi.uploadPhoto,
    onSuccess: (saved) => {
      afterChange(saved);
      toast.success('Your photo was updated.');
    },
  });
  const remove = useMutation({
    mutationFn: accountApi.deletePhoto,
    onSuccess: () => {
      afterChange(null);
      toast.success('Your photo was removed.');
    },
  });

  const onFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    upload.reset();
    if (file.size > MAX_BYTES) {
      toast.error('The photo is too large. The maximum size is 2 MB.');
      return;
    }
    upload.mutate(file);
  };

  const error = upload.error ?? remove.error;
  return (
    <Card role="region" aria-labelledby="profile-photo-title" className="flex min-w-0 flex-col overflow-hidden">
      <FlightBand />
      <div className="flex flex-1 flex-col px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <label htmlFor={inputId} className="group relative -mt-14 shrink-0 rounded-full">
            <span aria-hidden="true" className="absolute inset-0 rounded-full bg-role-400/30 opacity-0 animate-halo" />
            <span aria-hidden="true" className="absolute inset-0 rounded-full bg-role-400/30 opacity-0 animate-halo [animation-delay:1.2s]" />
            {user ? (
              <Avatar user={{ ...user, hasPhoto: profile.hasPhoto }} size="hero" className="shadow-xl ring-4 ring-white" />
            ) : (
              <span aria-hidden="true" className="relative flex size-28 items-center justify-center rounded-full bg-slate-100 text-slate-500 shadow-xl ring-4 ring-white">
                <UserRound className="size-12 text-current" />
              </span>
            )}
            {/* On hover the photo darkens and shows the camera: it is clickable. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/60 text-white opacity-0 backdrop-blur-[3px] transition-opacity duration-(--duration-base) group-hover:opacity-100"
            >
              <Camera className="size-7" />
            </span>
            <span
              aria-hidden="true"
              className="absolute bottom-1 right-1 flex size-9 items-center justify-center rounded-full bg-role-600 text-white shadow-md ring-[3px] ring-white animate-pop [animation-delay:350ms]"
            >
              <Camera className="size-4" />
            </span>
          </label>
          <div className="min-w-[10rem] flex-1 pb-1">
            <h2 id="profile-photo-title" className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">Profile photo</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">Shown next to your name in the menu at the top of every page.</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED}
            tabIndex={-1}
            className="sr-only"
            aria-label="Choose a profile photo"
            onChange={onFileChosen}
          />
          <Button variant="secondary" loading={upload.isPending} onClick={() => inputRef.current?.click()}>
            <Camera className="size-4" aria-hidden="true" />
            {profile.hasPhoto ? 'Change photo' : 'Upload photo'}
          </Button>
          {profile.hasPhoto && (
            <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 className="size-4" aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>
        {error && <Alert tone="danger" className="mt-4">{ApiError.from(error).message}</Alert>}
        <p className="mt-auto flex items-start gap-2 pt-5 text-xs leading-relaxed text-slate-500">
          <ShieldCheck className="mt-px size-4 shrink-0" aria-hidden="true" />
          JPEG or PNG, up to 2 MB. We resize it and remove hidden location data.
        </p>
      </div>
    </Card>
  );
}

/** The flight path: from a dot at the lower left, rising to the plane (viewBox 320 × 112). */
const ROUTE = 'M24 90 C 112 104, 196 62, 284 26';
/** lucide's plane (24 × 24), drawn inside the band's SVG so it stays on the path at any width. */
const PLANE =
  'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z';

/**
 * Decorative top of the photo card: the checkout band's drifting gradient with a dashed flight path that draws itself
 * (a mask path with `animate-draw-path`) and a plane that arrives at its end and floats. Under reduced motion all of it
 * is simply there.
 */
function FlightBand() {
  const maskId = `flight-path-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div
      aria-hidden="true"
      className="relative isolate h-28 shrink-0 overflow-hidden bg-[linear-gradient(125deg,var(--role-950),var(--role-800)_45%,var(--role-600)_80%,var(--role-800))] bg-[length:220%_220%] animate-gradient-pan"
    >
      <div className="absolute inset-0 -z-10 bg-grid-faint" />
      <div className="absolute -right-12 -top-20 -z-10 size-60 rounded-full bg-role-400/35 blur-3xl" />
      <div className="absolute -bottom-24 left-1/3 -z-10 size-52 rounded-full bg-accent-400/20 blur-3xl" />
      <svg viewBox="0 0 320 112" fill="none" className="absolute inset-y-0 right-0 h-full w-[min(20rem,72%)]">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="112">
            <path d={ROUTE} stroke="#fff" strokeWidth="8" strokeLinecap="round" pathLength={1} className="animate-draw-path [stroke-dasharray:1]" />
          </mask>
        </defs>
        <circle cx="24" cy="90" r="10" stroke="#fff" strokeOpacity="0.3" />
        <circle cx="24" cy="90" r="4" fill="#fff" fillOpacity="0.9" />
        <path d={ROUTE} stroke="#fff" strokeOpacity="0.6" strokeWidth="2" strokeLinecap="round" strokeDasharray="6 7" mask={`url(#${maskId})`} />
        <g transform="translate(284 9) rotate(23 12 12)">
          <g className="animate-float">
            <g className="origin-center [transform-box:fill-box] animate-pop [animation-delay:1.4s]">
              <path d={PLANE} fill="#fff" fillOpacity="0.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
