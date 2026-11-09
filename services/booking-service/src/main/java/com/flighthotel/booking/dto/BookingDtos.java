package com.flighthotel.booking.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.PaymentStatus;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Request and response bodies of {@code /api/bookings} and {@code /api/coupons}. */
public final class BookingDtos {

    private static final String NAME = "^[\\p{L}][\\p{L} .'-]*$";
    private static final String PHONE = "^\\+?[0-9][0-9 -]{6,18}$";

    private BookingDtos() {
    }

    // ------------------------------------------------------------------ create

    /**
     * Book the stay of a quote. Only the quote id, guests and contact come from the browser: the hotel, the dates and
     * every price come from hotel-service when it holds the rooms.
     */
    public record CreateHotelBookingRequest(
            @NotNull UUID quoteId,
            @NotNull @Valid Contact contact,
            @NotNull @Size(min = 1, max = 8) List<@NotNull @Valid GuestName> guests,
            @Size(max = 500) String specialRequests,
            @Size(max = 30) @Pattern(regexp = "^[A-Za-z0-9-]*$", message = "may only contain letters, digits and -")
            String couponCode) {
    }

    public record Contact(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Pattern(regexp = PHONE, message = "must be a valid phone number") String phone) {
    }

    /** The guest who will check in to room {@code roomNo} (one per room). */
    public record GuestName(
            @Min(1) @Max(8) int roomNo,
            @NotBlank @Size(max = 60) @Pattern(regexp = NAME, message = "may only contain letters, spaces, . ' -")
            String firstName,
            @NotBlank @Size(max = 60) @Pattern(regexp = NAME, message = "may only contain letters, spaces, . ' -")
            String lastName) {
    }

    /**
     * Book the trip of a revalidated offer. Only the trip offer id, the travellers and the contact come from the
     * browser: routes, fares and every price come from flight-service when it holds the seats. One entry per traveller:
     * adults first, then children, then infants.
     */
    public record CreateFlightBookingRequest(
            @NotNull @Size(min = 8, max = 40) @Pattern(regexp = "^[A-Za-z0-9-]+$") String tripOfferId,
            @NotNull @Valid Contact contact,
            @NotNull @Size(min = 1, max = 18) List<@NotNull @Valid PassengerInput> passengers,
            @Size(max = 30) @Pattern(regexp = "^[A-Za-z0-9-]*$", message = "may only contain letters, digits and -")
            String couponCode) {
    }

    public record PassengerInput(
            @NotNull @Pattern(regexp = "^(ADULT|CHILD|INFANT)$", message = "must be ADULT, CHILD or INFANT")
            String passengerType,
            @NotBlank @Size(max = 60) @Pattern(regexp = NAME, message = "may only contain letters, spaces, . ' -")
            String firstName,
            @NotBlank @Size(max = 60) @Pattern(regexp = NAME, message = "may only contain letters, spaces, . ' -")
            String lastName,
            LocalDate dateOfBirth,
            @Pattern(regexp = "^(MALE|FEMALE|OTHER)?$", message = "must be MALE, FEMALE or OTHER") String gender,
            @Pattern(regexp = "^([A-Za-z]{2})?$", message = "must be a 2-letter country code") String nationality,
            @Pattern(regexp = "^([A-Za-z0-9]{5,20})?$", message = "must be 5-20 letters or digits")
            String passportNumber,
            LocalDate passportExpiry,
            @Pattern(regexp = "^([A-Za-z]{2})?$", message = "must be a 2-letter country code")
            String passportCountry) {
    }

    // ------------------------------------------------------------------ read

    public record BookingSummary(
            UUID id,
            String reference,
            BookingType type,
            BookingStatus status,
            PaymentStatus paymentStatus,
            String title,
            String destination,
            LocalDate startDate,
            LocalDate endDate,
            BigDecimal totalAmount,
            String currency,
            Instant createdAt,
            boolean demo,
            boolean canCancel,
            HotelBrief stay,
            FlightBrief flight) {
    }

    /** The hotel facts a My Trips card shows (the full stay is in {@link HotelStay}). Null for flights. */
    public record HotelBrief(String hotelSlug, String hotelName, String city, String roomTypeName, Integer rooms,
                             Integer adults, Integer children, Integer nights) {
    }

    /** The flight facts a My Trips card shows (the full trip is in {@link FlightTrip}). Null for hotels. */
    public record FlightBrief(String tripType, String cabin, int adults, int children, int infants,
                              List<String> passengerNames, List<SliceView> slices) {
    }

    /**
     * @param canPay           the customer can start (or retry) a payment now
     * @param paymentDeadline  no new payment after this moment
     * @param failureReason    e.g. SOLD_OUT, PRICE_CHANGED, QUOTE_EXPIRED, NO_RESPONSE, ROOMS_RELEASED
     */
    public record BookingDetails(
            UUID id,
            String reference,
            BookingType type,
            BookingStatus status,
            PaymentStatus paymentStatus,
            String title,
            String destination,
            LocalDate startDate,
            LocalDate endDate,
            String currency,
            BigDecimal baseAmount,
            BigDecimal taxAmount,
            BigDecimal feeAmount,
            BigDecimal discountAmount,
            BigDecimal totalAmount,
            List<PriceLine> priceItems,
            String couponCode,
            String couponNote,
            String contactEmail,
            String contactPhone,
            Instant createdAt,
            Instant holdExpiresAt,
            Instant paymentDeadline,
            Instant confirmedAt,
            String failureReason,
            String failureMessage,
            boolean canPay,
            boolean demo,
            HotelStay hotel,
            FlightTrip flight,
            boolean canCancel,
            CancellationView cancellation,
            BigDecimal refundedAmount,
            List<RefundItem> refunds,
            AttentionView attention,
            List<SupportNoteView> supportNotes) {
    }

    /** {@code pnr} and the ticket numbers are null until the airline issued the booking (golden rule 3). */
    public record FlightTrip(
            String offerId,
            String tripType,
            String cabin,
            String fareName,
            Boolean refundable,
            Integer checkedBaggageKg,
            Integer cabinBaggageKg,
            Integer cancellationFeePercent,
            String cancellationPolicy,
            int adults,
            int children,
            int infants,
            boolean demo,
            String pnr,
            List<SliceView> slices,
            List<PassengerView> passengers) {
    }

    public record SliceView(String origin, String destination, String originCity, String destinationCity,
                            String departureLocal, String arrivalLocal, int durationMinutes, int stops,
                            List<SegmentView> segments) {
    }

    public record SegmentView(String flightNumber, String airlineCode, String airlineName, String origin,
                              String destination, String departureLocal, String arrivalLocal, int durationMinutes) {
    }

    public record PassengerView(int passengerNo, String passengerType, String firstName, String lastName,
                                LocalDate dateOfBirth, String gender, String nationality, String passportLast4,
                                String ticketNumber) {
    }

    /** {@code confirmationNumber} is null until the hotel confirmed (BOOKING_WORKFLOW.md golden rule 3). */
    public record HotelStay(
            UUID quoteId,
            UUID hotelId,
            String hotelSlug,
            String hotelName,
            String city,
            String address,
            String roomTypeName,
            String ratePlanName,
            Boolean breakfastIncluded,
            LocalDate checkIn,
            LocalDate checkOut,
            String checkInTime,
            String checkOutTime,
            Integer nights,
            Integer rooms,
            Integer adults,
            Integer children,
            String confirmationNumber,
            List<GuestItem> guests,
            String specialRequests,
            CancellationTerms cancellation) {
    }

    public record GuestItem(int roomNo, String firstName, String lastName) {
    }

    /** Discounts are negative. */
    public record PriceLine(String type, String label, BigDecimal amount) {
    }

    public record CancellationTerms(Boolean refundable, Instant freeCancellationUntil, BigDecimal feePercent,
                                    String policy) {
    }

    /** {@code fromStatus == status}: something happened that kept the status (e.g. a failed payment). */
    public record TimelineEntry(BookingStatus fromStatus, BookingStatus status, String reason, Instant at) {
    }

    // ------------------------------------------------------------------ cancellations and refunds (Phase 7)

    /**
     * @param expectedRefundAmount the refund the customer saw; a different amount today answers 409
     * @param waiveFee             full refund (permission REFUND_MANAGE)
     */
    public record CancelRequest(
            @Size(max = 500) String reason,
            @DecimalMin("0.00") @Digits(integer = 10, fraction = 2) BigDecimal expectedRefundAmount,
            Boolean waiveFee) {
    }

    public record CancellationQuoteView(UUID bookingId, boolean cancellable, String reasonCode, String message,
                                        String currency, BigDecimal paidAmount, BigDecimal cancellationFee,
                                        BigDecimal refundAmount, boolean feeWaived, boolean freeCancellation,
                                        Instant freeCancellationUntil, Instant cancelUntil, String feeDescription,
                                        String policy, Instant quotedAt) {
    }

    /** {@code cancellationFee} / {@code refundAmount}: the quote while PENDING, final once CONFIRMED. */
    public record CancellationView(UUID id, String status, String initiatedBy, String reason, boolean feeWaived,
                                   String currency, BigDecimal cancellationFee, BigDecimal refundAmount,
                                   Instant requestedAt, Instant completedAt, String supplierReference,
                                   String failureReason, String failureMessage) {
    }

    public record RefundItem(UUID id, BigDecimal amount, String currency, String reason, String status,
                             Instant requestedAt, Instant completedAt) {
    }

    public record AttentionView(String reason, String note, Instant since) {
    }

    public record SupportNoteView(String action, String note, String authorRole, Instant createdAt) {
    }

    /** One row of the support booking lookup. */
    public record SupportBookingRow(UUID id, String reference, BookingType type, BookingStatus status,
                                    PaymentStatus paymentStatus, String title, String destination, LocalDate startDate,
                                    LocalDate endDate, BigDecimal totalAmount, String currency, Instant createdAt,
                                    String contactEmail, String leadName, String attentionReason,
                                    Instant attentionSince, boolean demo) {
    }

    public record EscalateRequest(@NotBlank @Size(max = 500) String note) {
    }

    public record ResolveRequest(@Size(max = 500) String note) {
    }

    // ------------------------------------------------------------------ coupons

    /** Preview only: the real discount is calculated from the price hotel-service holds. */
    public record CouponCheckRequest(
            @NotBlank @Size(max = 30) String code,
            @NotNull BookingType bookingType,
            @NotNull @DecimalMin("1.00") @Digits(integer = 10, fraction = 2) BigDecimal amount,
            @Size(max = 100) String destinationCity) {
    }

    public record CouponCheckResponse(String code, String title, String description, BigDecimal discount,
                                      BigDecimal totalAfterDiscount, String currency) {
    }
}
