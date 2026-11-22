import { BellRing, KeyRound, LogOut, Luggage, ShieldCheck, Users } from 'lucide-react';

import { CustomerSignInIllustration } from '@/components/illustrations';

import { PORTAL_CONTENT } from './signin/portalContent';

/** Register and "check your inbox": what a customer account gives you. */
export const REGISTER_STORY = {
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
export const ACCOUNT_STORY = {
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
export function accountStoryFor(portal) {
  return { ...ACCOUNT_STORY, Illustration: PORTAL_CONTENT[portal].Illustration };
}
