package com.flighthotel.booking.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.FlightBooking;
import com.flighthotel.booking.entity.HotelBooking;

/**
 * The cancellation rules of BOOKING_WORKFLOW.md section 4, applied to the terms the customer accepted (the snapshot
 * taken when the rooms or seats were held), never to today's terms of the hotel or airline.
 * <ul>
 * <li>Hotels: free before {@code freeCancellationUntil}; afterwards the fee % of the stay price (room charges + GST,
 * before the coupon). Possible until the check-in moment.</li>
 * <li>Flights: the fee % of the fare (taxes and airline charges are refunded; non-refundable fares are 100 %).
 * Possible until 4 hours before the first departure. The airline's own fee is final when it confirms.</li>
 * </ul>
 * The refund is what was paid minus the fee (never negative); a coupon discount is not given back.
 */
@Component
public class CancellationPolicy {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    public static final String NOT_CONFIRMED = "NOT_CONFIRMED";
    public static final String CANCELLATION_IN_PROGRESS = "CANCELLATION_IN_PROGRESS";
    public static final String ALREADY_CANCELLED = "ALREADY_CANCELLED";
    public static final String COMPLETED = "COMPLETED";
    public static final String TOO_LATE = "TOO_LATE";

    private final Duration flightCutoff;

    public CancellationPolicy(@Value("${booking.flight-cancel-cutoff:4h}") Duration flightCutoff) {
        this.flightCutoff = flightCutoff;
    }

    /** What cancelling now would cost and return. Not cancellable: fee and refund are 0, {@code reasonCode} says why. */
    public record Quote(boolean cancellable, String reasonCode, String message, String currency, BigDecimal paidAmount,
            BigDecimal cancellationFee, BigDecimal refundAmount, boolean feeWaived, boolean freeCancellation,
            Instant freeCancellationUntil, Instant cancelUntil, String feeDescription, String policy, Instant quotedAt) {
    }

    /**
     * @param alreadyRefunded goodwill refunds given while the booking stood: the cancellation works on the money the
     *        customer still has with us (the fee is capped by it, the refund is what is left after the fee)
     */
    public Quote quote(Booking booking, HotelBooking hotel, FlightBooking flight, BigDecimal alreadyRefunded,
            boolean waive, Instant at) {
        BigDecimal paid = booking.getTotalAmount().subtract(alreadyRefunded).max(BigDecimal.ZERO);
        String currency = booking.getCurrency();
        Instant freeUntil = hotel != null && Boolean.TRUE.equals(hotel.getRefundable())
                ? hotel.getFreeCancellationUntil() : null;
        String reason = notCancellable(booking, at);
        if (reason != null) {
            return new Quote(false, reason, message(reason, booking.getBookingType()), currency, paid, BigDecimal.ZERO,
                    BigDecimal.ZERO, false, false, freeUntil, booking.getCancelUntil(), null,
                    booking.getCancellationPolicySnapshot(), at);
        }
        Fee fee;
        if (waive) {
            fee = new Fee(BigDecimal.ZERO, "Fee waived: the full amount is refunded", false);
        } else if (booking.getBookingType() == BookingType.HOTEL) {
            fee = hotelFee(booking, hotel, at);
        } else {
            fee = flightFee(booking, flight);
        }
        BigDecimal charged = fee.amount().min(paid);
        return new Quote(true, null, null, currency, paid, charged, paid.subtract(charged), waive, fee.free(),
                freeUntil, booking.getCancelUntil(), fee.description(), booking.getCancellationPolicySnapshot(), at);
    }

    /** For lists: the Cancel button, without calculating the fee. */
    public static boolean canCancel(Booking booking, Instant at) {
        return notCancellable(booking, at) == null;
    }

    private static String notCancellable(Booking booking, Instant at) {
        return switch (booking.getStatus()) {
            case CONFIRMED -> {
                if (booking.getPaidPaymentId() == null) {
                    yield NOT_CONFIRMED;
                }
                yield booking.getCancelUntil() != null && !at.isBefore(booking.getCancelUntil()) ? TOO_LATE : null;
            }
            case CANCELLATION_PENDING -> CANCELLATION_IN_PROGRESS;
            case CANCELLED -> ALREADY_CANCELLED;
            case REFUND_PENDING, REFUNDED -> booking.getCancelledAt() != null ? ALREADY_CANCELLED : NOT_CONFIRMED;
            case COMPLETED -> COMPLETED;
            default -> NOT_CONFIRMED;
        };
    }

    private static String message(String reason, BookingType type) {
        return switch (reason) {
            case CANCELLATION_IN_PROGRESS -> "A cancellation of this booking is already in progress.";
            case ALREADY_CANCELLED -> "This booking is already cancelled.";
            case COMPLETED -> "This trip has already taken place.";
            case TOO_LATE -> type == BookingType.HOTEL
                    ? "The check-in time has passed, so this stay can no longer be cancelled online. Please contact "
                            + "our support team."
                    : "Flights can only be cancelled online up to 4 hours before departure. Please contact our "
                            + "support team.";
            default -> "Only confirmed bookings can be cancelled.";
        };
    }

    private static Fee hotelFee(Booking booking, HotelBooking hotel, Instant at) {
        BigDecimal stayPrice = booking.getBaseAmount().add(booking.getTaxAmount());
        boolean refundable = hotel != null && Boolean.TRUE.equals(hotel.getRefundable());
        if (refundable && hotel.getFreeCancellationUntil() != null && at.isBefore(hotel.getFreeCancellationUntil())) {
            return new Fee(BigDecimal.ZERO, "No fee: you are within the free cancellation period", true);
        }
        BigDecimal percent = hotel == null || hotel.getCancellationFeePercent() == null ? HUNDRED
                : hotel.getCancellationFeePercent();
        if (percent.signum() == 0) {
            return new Fee(BigDecimal.ZERO, "No cancellation fee", true);
        }
        BigDecimal fee = share(stayPrice, percent);
        String price = Amounts.format(stayPrice, booking.getCurrency());
        return new Fee(fee, percent.compareTo(HUNDRED) >= 0
                ? "Non-refundable: 100% of the stay price (" + price + ")"
                : percent.stripTrailingZeros().toPlainString() + "% of the stay price (" + price + ")", false);
    }

    private static Fee flightFee(Booking booking, FlightBooking flight) {
        BigDecimal fare = booking.getBaseAmount();
        BigDecimal percent = flight == null || flight.getCancellationFeePercent() == null ? HUNDRED
                : BigDecimal.valueOf(flight.getCancellationFeePercent());
        if (percent.signum() == 0) {
            return new Fee(BigDecimal.ZERO, "No cancellation fee", true);
        }
        String price = Amounts.format(fare, booking.getCurrency());
        return new Fee(share(fare, percent), percent.compareTo(HUNDRED) >= 0
                ? "Non-refundable fare: the fare (" + price + ") is kept; taxes and charges are refunded"
                : percent.toPlainString() + "% of the fare (" + price + "); taxes and charges are refunded", false);
    }

    private static BigDecimal share(BigDecimal amount, BigDecimal percent) {
        return amount.multiply(percent).divide(HUNDRED, 2, RoundingMode.HALF_UP);
    }

    /** Hotels: the check-in moment; when the hold did not say (older events), check-in time in India. */
    public static Instant hotelCancelUntil(Instant checkInAt, LocalDate checkIn, String checkInTime) {
        if (checkInAt != null) {
            return checkInAt;
        }
        return LocalDateTime.of(checkIn, LocalTime.parse(checkInTime)).atZone(INDIA).toInstant();
    }

    /** Flights: the cutoff before the first departure; when the hold did not say, the local time read as India. */
    public Instant flightCancelUntil(Instant departureAt, String departureLocal) {
        return flightDeparture(departureAt, departureLocal).minus(flightCutoff);
    }

    /** The first departure (airport time zone); older events without it: the local time read as India. */
    public static Instant flightDeparture(Instant departureAt, String departureLocal) {
        return departureAt != null ? departureAt : LocalDateTime.parse(departureLocal).atZone(INDIA).toInstant();
    }

    private record Fee(BigDecimal amount, String description, boolean free) {
    }
}
