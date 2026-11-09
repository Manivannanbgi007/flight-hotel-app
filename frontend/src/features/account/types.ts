import type { Role } from '@/lib/auth/types';

/** API_DOCUMENTATION.md §3.1 */
export interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  roles: Role[];
  emailVerified: boolean;
  hasPhoto: boolean;
  memberSince: string;
}

export interface UpdateProfileRequest {
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: string;
  nationality?: string;
}

export type PassengerType = 'ADULT' | 'CHILD' | 'INFANT';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

/** §3.2 — the passport number is never returned in full. */
export interface Passenger {
  id: string;
  passengerType: PassengerType;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  nationality: string | null;
  hasPassport: boolean;
  passportNumberMasked: string | null;
  passportExpiry: string | null;
  passportCountry: string | null;
}

export interface PassengerRequest {
  passengerType: PassengerType;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  gender?: Gender;
  nationality?: string;
  passportNumber?: string;
  passportExpiry?: string;
  passportCountry?: string;
  removePassport?: boolean;
}

export type CabinClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
export type SeatPreference = 'WINDOW' | 'AISLE' | 'NO_PREFERENCE';
export type MealPreference =
  | 'NO_PREFERENCE' | 'STANDARD' | 'VEGETARIAN' | 'VEGAN' | 'JAIN' | 'HALAL' | 'KOSHER' | 'DIABETIC';

/** §3.3 */
export interface TravelPreferences {
  preferredCabin: CabinClass | null;
  homeAirport: string | null;
  seatPreference: SeatPreference | null;
  mealPreference: MealPreference | null;
  preferredCurrency: 'INR';
  newsletterOptIn: boolean;
}

/** §3.4 */
export interface LoginHistoryEntry {
  occurredAt: string;
  success: boolean;
  failureReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
