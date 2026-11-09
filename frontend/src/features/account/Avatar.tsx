import { useEffect, useMemo } from 'react';

import { Avatar as AvatarView, type AvatarSize } from '@/components/ui/Avatar';
import type { AuthUser } from '@/lib/auth/types';
import { useProfilePhoto } from './useAccount';

/** `header` (56 px) is the "My account" banner; `hero` (112 px) the profile photo card. */
const sizeMap = { sm: 'sm', md: 'md', header: 'lg', lg: 'xl', hero: '2xl' } as const satisfies Record<string, AvatarSize>;

/** The signed-in user's profile photo, or their initials when there is none (or it is still loading). */
export function Avatar({ user, size = 'sm', className }: {
  user: Pick<AuthUser, 'firstName' | 'lastName' | 'hasPhoto'>;
  size?: keyof typeof sizeMap;
  className?: string;
}) {
  const { data: photo } = useProfilePhoto();
  const url = useObjectUrl(user.hasPhoto ? photo : undefined);
  return (
    <AvatarView
      name={`${user.firstName} ${user.lastName}`}
      src={url}
      size={sizeMap[size]}
      tint="bg-gradient-to-br from-brand-100 to-brand-200 text-brand-800"
      className={className}
    />
  );
}

/** A temporary `blob:` URL for the blob, released when the blob changes or the component goes away. */
function useObjectUrl(blob: Blob | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(
    () => () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    },
    [url],
  );
  return url;
}
