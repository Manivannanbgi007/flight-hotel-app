import type { ComponentType } from 'react';
import { BellRing, KeyRound, LogOut, Luggage, ShieldCheck, Users, type LucideIcon } from 'lucide-react';

import { CustomerSignInIllustration, type IllustrationProps } from '@/components/illustrations';
import type { Portal } from '@/lib/auth/portals';
import { PORTAL_CONTENT } from './signin/portalContent';

/** The illustrated panel beside an auth screen (`AuthShell`): what the portal or the account is for (features only, no figures). */
export interface AuthStory {
  /** The panel's h2; it also names the panel's region. */
  title: string;
  text: string;
  points: { icon: LucideIcon; text: string }[];
  Illustration: ComponentType<IllustrationProps>;
}

/** Register and "check your inbox": what a customer account gives you. */
export const REGISTER_STORY: AuthStory = {
  title: 'Travel planned, booked and tracked in one place',
  text: 'One account for every flight and stay, with documents, changes and refunds together.',
  points: [
    { icon: Luggage, text: 'All your trips in one place' },
    { icon: BellRing, text: 'Live booking updates, by e-mail and in the app' },
    { icon: Users, text: 'Save the people you travel with for a faster checkout' },
  ],
  Illustration: CustomerSignInIllustration,
};

/** Forgot / reset password and e-mail verification: how account access is kept safe (true of every portal). */
export const ACCOUNT_STORY: AuthStory = {
  title: 'Safe, simple access to your account',
  text: 'Password links are personal, work only once and expire quickly, so your account stays yours.',
  points: [
    { icon: KeyRound, text: 'Reset links work once and expire after an hour' },
    { icon: LogOut, text: 'A new password signs you out on every device' },
    { icon: ShieldCheck, text: 'Commonly used passwords are refused' },
  ],
  Illustration: CustomerSignInIllustration,
};

/** The account story with the illustration of the portal a password page was opened from (`?portal=admin` ...). */
export function accountStoryFor(portal: Portal): AuthStory {
  return { ...ACCOUNT_STORY, Illustration: PORTAL_CONTENT[portal].Illustration };
}
