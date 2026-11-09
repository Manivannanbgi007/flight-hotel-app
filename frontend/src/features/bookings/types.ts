/** Booking API shapes (API_DOCUMENTATION.md, Bookings). Amounts are rupee numbers; dates are ISO strings. */

export type BookingStatus =
  | 'INITIATED'
  | 'PENDING_PAYMENT'
  | 'PAYMENT_SUCCESS'
  | 'SUPPLIER_PENDING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'FAILED'
  | 'EXPIRED';

export type BookingPaymentStatus = 'UNPAID' | 'PAYMENT_FAILED' | 'PAID' | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

export type BookingTab = 'ALL' | 'PENDING' | 'UPCOMING' | 'COMPLETED' | 'CANCELLED';

export interface BookingSummary {
  id: string;
  reference: string;
  type: 'HOTEL' | 'FLIGHT';
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  title: string | null;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  totalAmount: number;
  currency: string;
  createdAt: string;
  demo: boolean;
  /** The customer may cancel it now (the "Cancel" link). */
  canCancel: boolean;
  /** The hotel facts of a stay (My Trips card); null for a flight. Missing in older answers. */
  stay?: HotelBrief | null;
  /** The flight facts of a trip (My Trips card); null for a hotel. Missing in older answers. */
  flight?: FlightBrief | null;
}

export interface HotelBrief {
  hotelSlug: string | null;
  hotelName: string;
  city: string | null;
  roomTypeName: string | null;
  rooms: number | null;
  adults: number | null;
  children: number | null;
  nights: number | null;
}

export interface FlightBrief {
  tripType: 'ONE_WAY' | 'ROUND_TRIP';
  cabin: string;
  adults: number;
  children: number;
  infants: number;
  /** The travellers' names, in seat order (the customer's own booking). */
  passengerNames: string[];
  slices: FlightSliceInfo[];
}

/** My Trips filters beyond the tab: words of the reference, title or destination, and the kind of trip. */
export interface TripFilters {
  q?: string;
  type?: 'HOTEL' | 'FLIGHT' | '';
}

export interface PriceLine {
  type: 'ROOM' | 'TAX' | 'FEE' | 'DISCOUNT';
  label: string;
  amount: number;
}

export interface GuestItem {
  roomNo: number;
  firstName: string;
  lastName: string;
}

export interface CancellationTerms {
  refundable: boolean | null;
  freeCancellationUntil: string | null;
  feePercent: number | null;
  policy: string | null;
}

export interface HotelStay {
  quoteId: string;
  hotelId: string | null;
  hotelSlug: string | null;
  hotelName: string | null;
  city: string | null;
  address: string | null;
  roomTypeName: string | null;
  ratePlanName: string | null;
  breakfastIncluded: boolean | null;
  checkIn: string | null;
  checkOut: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  nights: number | null;
  rooms: number | null;
  adults: number | null;
  children: number | null;
  /** Only after the hotel confirmed (BOOKING_WORKFLOW.md golden rule 3). */
  confirmationNumber: string | null;
  guests: GuestItem[];
  specialRequests: string | null;
  cancellation: CancellationTerms | null;
}

export interface BookingDetails {
  id: string;
  reference: string;
  type: 'HOTEL' | 'FLIGHT';
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  title: string | null;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  currency: string;
  baseAmount: number;
  taxAmount: number;
  feeAmount: number;
  discountAmount: number;
  totalAmount: number;
  priceItems: PriceLine[];
  couponCode: string | null;
  couponNote: string | null;
  contactEmail: string;
  contactPhone: string;
  createdAt: string;
  holdExpiresAt: string | null;
  paymentDeadline: string | null;
  confirmedAt: string | null;
  /** SOLD_OUT, PRICE_CHANGED, QUOTE_EXPIRED, NO_RESPONSE, PAYMENT_TIMEOUT, ... */
  failureReason: string | null;
  failureMessage: string | null;
  /** The customer can start (or retry) a payment now. */
  canPay: boolean;
  demo: boolean;
  hotel: HotelStay | null;
  /** Flight bookings carry `flight` instead of `hotel` (API_DOCUMENTATION.md §8.1a). */
  flight?: FlightTrip | null;
  /** The customer may cancel it now (the "Cancel booking" button). */
  canCancel: boolean;
  /** The latest cancellation request, or null. */
  cancellation: Cancellation | null;
  /** Money returned so far. */
  refundedAmount: number;
  refunds: RefundItem[];
  /** Why support should look at it; only for staff with BOOKING_READ_ANY, null for customers. */
  attention: Attention | null;
  /** Internal support history, oldest first; only for staff with BOOKING_READ_ANY (customers get []). Never shown to customers. */
  supportNotes: SupportNote[];
}

/** Why a booking cannot be cancelled now (quote `reasonCode`, `details.reasonCode` of `409 BOOKING_NOT_CANCELLABLE`). */
export type NotCancellableReason = 'NOT_CONFIRMED' | 'CANCELLATION_IN_PROGRESS' | 'ALREADY_CANCELLED' | 'COMPLETED' | 'TOO_LATE';

/** `GET /api/bookings/{id}/cancellation-quote` (API_DOCUMENTATION.md §8.4). Every amount comes from the server. */
export interface CancellationQuote {
  bookingId: string;
  cancellable: boolean;
  reasonCode: NotCancellableReason | null;
  /** Why it cannot be cancelled, in words. */
  message: string | null;
  currency: string;
  paidAmount: number;
  cancellationFee: number;
  refundAmount: number;
  feeWaived: boolean;
  /** The fee is 0 right now. */
  freeCancellation: boolean;
  freeCancellationUntil: string | null;
  /** Hotels: the check-in moment; flights: 4 hours before the first departure. */
  cancelUntil: string | null;
  feeDescription: string | null;
  policy: string | null;
  quotedAt: string;
}

export interface CancelBookingBody {
  /** Up to 500 characters; required when staff cancel someone else's booking. */
  reason?: string;
  /** The refund the user saw; the server answers 409 CANCELLATION_QUOTE_CHANGED when today's figure differs. */
  expectedRefundAmount: number;
  /** Full refund; needs REFUND_MANAGE. */
  waiveFee?: boolean;
}

export type CancellationStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';
export type CancellationInitiator = 'CUSTOMER' | 'SUPPORT_AGENT' | 'ADMIN' | 'HOTEL';

export interface Cancellation {
  id: string;
  /** CONFIRMED only once the hotel or airline confirmed it; REJECTED leaves the booking CONFIRMED. */
  status: CancellationStatus;
  initiatedBy: CancellationInitiator;
  reason: string | null;
  feeWaived: boolean;
  currency: string;
  cancellationFee: number;
  refundAmount: number;
  requestedAt: string;
  completedAt: string | null;
  supplierReference: string | null;
  failureReason: string | null;
  failureMessage: string | null;
}

export type RefundReason = 'CANCELLATION' | 'BOOKING_FAILED' | 'LATE_PAYMENT' | 'DUPLICATE_PAYMENT' | 'GOODWILL';
export type RefundStatus = 'REQUESTED' | 'COMPLETED' | 'FAILED';

export interface RefundItem {
  id: string;
  amount: number;
  currency: string;
  reason: RefundReason;
  status: RefundStatus;
  requestedAt: string;
  completedAt: string | null;
}

export type AttentionReason =
  | 'REFUND_FAILED'
  | 'CANCELLATION_REJECTED'
  | 'CANCELLATION_NO_ANSWER'
  | 'REFUND_NO_ANSWER'
  | 'REFUND_DIFFERS'
  | 'ESCALATED';

/** A booking in the support "Needs attention" queue (API_DOCUMENTATION.md §8.5). Notes are internal. */
export interface Attention {
  reason: AttentionReason;
  note: string | null;
  since: string;
}

export interface FlightSegmentInfo {
  flightNumber: string;
  airlineCode: string;
  airlineName: string;
  origin: string;
  destination: string;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number;
}

export interface FlightSliceInfo {
  origin: string;
  destination: string;
  originCity: string;
  destinationCity: string;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number;
  stops: number;
  segments: FlightSegmentInfo[];
}

export interface FlightPassengerInfo {
  passengerNo: number;
  passengerType: 'ADULT' | 'CHILD' | 'INFANT';
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  nationality: string | null;
  /** The passport number is never returned in full. */
  passportLast4: string | null;
  /** null until the airline issued the booking. */
  ticketNumber: string | null;
}

export interface FlightTrip {
  offerId: string;
  tripType: 'ONE_WAY' | 'ROUND_TRIP';
  cabin: string;
  fareName: string;
  refundable: boolean;
  checkedBaggageKg: number;
  cabinBaggageKg: number;
  cancellationFeePercent: number;
  cancellationPolicy: string | null;
  adults: number;
  children: number;
  infants: number;
  demo: boolean;
  /** null until the airline issued the booking (golden rule 3). */
  pnr: string | null;
  slices: FlightSliceInfo[];
  passengers: FlightPassengerInfo[];
}

export interface CreateFlightBookingBody {
  tripOfferId: string;
  contact: { email: string; phone: string };
  passengers: {
    passengerType: 'ADULT' | 'CHILD' | 'INFANT';
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
    gender?: string;
    nationality?: string;
    passportNumber?: string;
    passportExpiry?: string;
    passportCountry?: string;
  }[];
  couponCode?: string;
}

export interface TimelineEntry {
  fromStatus: BookingStatus | null;
  status: BookingStatus;
  reason: string | null;
  at: string;
}

export interface CreateHotelBookingBody {
  quoteId: string;
  contact: { email: string; phone: string };
  guests: { roomNo: number; firstName: string; lastName: string }[];
  specialRequests?: string;
  couponCode?: string;
}

export interface CouponCheckBody {
  code: string;
  bookingType: 'HOTEL' | 'FLIGHT';
  amount: number;
  destinationCity?: string;
}

export interface CouponCheckResult {
  code: string;
  title: string;
  description: string;
  discount: number;
  totalAfterDiscount: number;
  currency: string;
}

export type SupportNoteAction = 'ESCALATED' | 'RESOLVED' | 'REFUND_RETRIED' | 'CANCELLED_ON_BEHALF';

/** One entry of the internal support history of a booking. */
export interface SupportNote {
  action: SupportNoteAction;
  note: string | null;
  authorRole: 'SUPPORT_AGENT' | 'ADMIN';
  createdAt: string;
}
