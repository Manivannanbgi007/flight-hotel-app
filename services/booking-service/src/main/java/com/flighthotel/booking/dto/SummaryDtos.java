package com.flighthotel.booking.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.BookingType;

/**
 * The customer dashboard, {@code GET /api/bookings/summary} (Phase 11 §11.3). Only the signed-in user's own bookings.
 * Money is the booking currency (INR), two decimals.
 */
public final class SummaryDtos {

    private SummaryDtos() {
    }

    /** {@code preset}: a range preset, {@code CUSTOM} or {@code ALL_TIME}; both days inclusive (India days). */
    public record SummaryRange(String preset, LocalDate from, LocalDate to) {
    }

    /**
     * Bookings created in the range that were paid and confirmed by the hotel or airline (at any time), and what
     * became of them: still ahead ({@code CONFIRMED}, {@code CANCELLATION_PENDING}), completed, or cancelled.
     */
    public record BookingCounts(long total, long hotel, long flight, long upcoming, long completed, long cancelled) {
    }

    /**
     * All the user's bookings as they are now, like the My Trips tabs: {@code upcoming} (confirmed, also with a
     * cancellation request waiting), {@code completed}, {@code cancelled} (cancelled after confirmation),
     * {@code pending} (not paid or not confirmed yet).
     */
    public record TripCounts(long upcoming, long completed, long cancelled, long pending) {
    }

    /** {@code paid} − {@code refunded} = {@code net}. */
    public record Money(BigDecimal paid, BigDecimal refunded, BigDecimal net) {
    }

    /**
     * The money of the bookings created in the range: {@code paid} = their totals once paid, {@code refunded} =
     * refunds of them that completed, {@code refundsInProgress} = refunds asked for and not completed yet. A second
     * (duplicate) payment of a booking is refunded and never counts.
     */
    public record Spending(String currency, BigDecimal paid, BigDecimal refunded, BigDecimal net,
            BigDecimal refundsInProgress, Money hotel, Money flight) {
    }

    /** One calendar month of the range (the first and last cut to the range), by booking creation day. */
    public record MonthActivity(String month, LocalDate start, LocalDate end, long bookings, long hotelBookings,
            long flightBookings, BigDecimal paid, BigDecimal refunded, BigDecimal net) {
    }

    public record NextHotel(String hotelName, String city, String address, LocalDate checkIn, LocalDate checkOut,
            String checkInTime, String checkOutTime, Integer nights, Integer rooms, Integer guests,
            String roomTypeName, String confirmationNumber) {
    }

    public record NextFlight(String tripType, String cabin, String origin, String destination, String originCity,
            String destinationCity, String departureLocal, String arrivalLocal, String airlineName,
            String flightNumber, int stops, Integer passengers, String pnr, String returnDepartureLocal) {
    }

    /**
     * The confirmed trip that starts first and has not ended yet ({@code inProgress}: it started already).
     * {@code daysUntil}: India days from today until the first day (0 today or in progress).
     */
    public record NextTrip(UUID bookingId, String reference, BookingType type, BookingStatus status, String title,
            String destination, LocalDate startDate, LocalDate endDate, Instant startsAt, long daysUntil,
            boolean inProgress, BigDecimal totalAmount, String currency, NextHotel hotel, NextFlight flight) {
    }

    public record CustomerSummary(SummaryRange range, BookingCounts bookings, TripCounts trips, Spending spending,
            List<MonthActivity> monthlyActivity, NextTrip nextTrip, Instant generatedAt) {
    }
}
