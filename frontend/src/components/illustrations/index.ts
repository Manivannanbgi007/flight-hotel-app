/**
 * Hand-made inline SVG illustrations (DESIGN_SYSTEM.md "Illustrations"). All are decorative (aria-hidden), take a
 * `className` for size (`className="w-48"`), scale to their box and use the token palette (palette.ts). No external
 * images or fonts: the CSP allows only 'self'.
 */
export { BoardingPassIllustration, GlobeIllustration, HotelIllustration, SuitcaseIllustration, TravelHeroIllustration } from './scenes';
export {
  AccessDeniedIllustration,
  EmptyInboxIllustration,
  LostIllustration,
  NoResultsIllustration,
  PaymentFailedIllustration,
  PaymentSuccessIllustration,
  StormIllustration,
} from './states';
export { AdminSignInIllustration, CustomerSignInIllustration, ManagerSignInIllustration, SupportSignInIllustration } from './roles';
export type { IllustrationProps } from './shapes';
export { P as ILLUSTRATION_PALETTE } from './palette';
