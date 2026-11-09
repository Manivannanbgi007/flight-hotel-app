package com.flighthotel.hotel.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.flighthotel.hotel.entity.CancelledBy;
import com.flighthotel.hotel.entity.ReservationStatus;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Hotel manager reservations, guests, check-in/out (API_DOCUMENTATION.md §14.5). */
public final class FrontDeskDtos {

    private FrontDeskDtos() {
    }

    /** Which date {@code from}/{@code to} filter on. */
    public enum DateField { CHECK_IN, CREATED }

    /**
     * One reservation in the manager's list.
     *
     * @param leadGuest   the guest named for room 1 ("Asha Rao")
     * @param totalAmount what the guest paid the hotel part of the booking: room charges + GST
     */
    public record ReservationRow(UUID reservationId, UUID bookingId, String bookingReference,
                                 ReservationStatus status, LocalDate checkIn, LocalDate checkOut, int nights,
                                 int rooms, int adults, int children, String roomTypeName, String ratePlanName,
                                 String leadGuest, BigDecimal totalAmount, String currency,
                                 String confirmationNumber, Instant createdAt) {
    }

    /**
     * Counts above the reservation list, for the same filters (except the status). {@code total} = every paid
     * reservation (confirmed, checked in, checked out, no-show, cancelled); {@code pending} = held, waiting for payment.
     */
    public record ReservationSummary(long total, long confirmed, long pending, long checkedIn, long checkedOut,
                                     long cancelled, long noShow) {
    }

    public record GuestItem(int roomNo, String firstName, String lastName) {
    }

    /** The row plus everything the front desk needs for the stay. */
    public record ReservationDetails(
            UUID reservationId,
            UUID bookingId,
            String bookingReference,
            ReservationStatus status,
            LocalDate checkIn,
            LocalDate checkOut,
            int nights,
            int rooms,
            int adults,
            int children,
            String roomTypeName,
            String ratePlanName,
            String leadGuest,
            BigDecimal subtotal,
            BigDecimal taxes,
            BigDecimal totalAmount,
            String currency,
            String confirmationNumber,
            Instant createdAt,
            List<GuestItem> guests,
            String contactEmail,
            String contactPhone,
            String specialRequests,
            Instant confirmedAt,
            Instant checkedInAt,
            Instant checkedOutAt,
            Instant noShowAt,
            Instant cancelledAt,
            String cancellationReference,
            CancelledBy cancelledBy,
            String cancellationReason) {
    }

    /** The hotel cancels a confirmed stay (overbooking, closure); the guest gets everything back. */
    public record HotelCancelRequest(@NotBlank @Size(min = 5, max = 300) String reason) {
    }
}
