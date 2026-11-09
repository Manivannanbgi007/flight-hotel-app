package com.flighthotel.booking.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.Cancellation;
import com.flighthotel.booking.entity.RefundRequest;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.CancellationRepository;
import com.flighthotel.booking.repository.RefundRequestRepository;
import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.flight.FlightBookingCancelled;
import com.flighthotel.events.flight.FlightCancellationFailed;
import com.flighthotel.events.hotel.HotelReservationCancellationFailed;
import com.flighthotel.events.hotel.HotelReservationCancelled;

/**
 * booking-service's reactions in the cancellation saga (BOOKING_WORKFLOW.md section 4): the hotel or airline confirmed
 * or refused, then the refund. Each handler runs in the Kafka listener's transaction, locks the booking and ignores
 * answers that do not belong to its pending cancellation (duplicates, late or repeated answers).
 * <p>
 * Also the booking side of reconciliation: a cancellation or refund request nobody answered is sent again (the hotel,
 * airline and payment-service answer repeated requests with the same outcome), and after a few tries the booking goes to
 * the support "Needs attention" queue.
 */
@Service
public class CancellationSaga {

    private static final Logger log = LoggerFactory.getLogger(CancellationSaga.class);
    static final String HOTEL = "HOTEL";

    private final BookingSaga saga;
    private final BookingRepository bookings;
    private final CancellationRepository cancellations;
    private final RefundRequestRepository refunds;
    private final BookingLifecycle lifecycle;
    private final BookingEvents events;
    private final AuditPublisher audit;
    private final Duration cancellationAfter;
    private final Duration refundAfter;
    private final int maxAttempts;
    private final Clock clock;

    public CancellationSaga(BookingSaga saga, BookingRepository bookings, CancellationRepository cancellations,
            RefundRequestRepository refunds, BookingLifecycle lifecycle, BookingEvents events, AuditPublisher audit,
            @Value("${booking.reconcile.cancellation-after:10m}") Duration cancellationAfter,
            @Value("${booking.reconcile.refund-after:30m}") Duration refundAfter,
            @Value("${booking.reconcile.max-attempts:3}") int maxAttempts, Clock clock) {
        this.saga = saga;
        this.bookings = bookings;
        this.cancellations = cancellations;
        this.refunds = refunds;
        this.lifecycle = lifecycle;
        this.events = events;
        this.audit = audit;
        this.cancellationAfter = cancellationAfter;
        this.refundAfter = refundAfter;
        this.maxAttempts = maxAttempts;
        this.clock = clock;
    }

    // ================================================================== the hotel or airline answered

    /** The rooms are back on sale: the fee is the booked policy's at the moment the customer asked. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void hotelCancelled(HotelReservationCancelled cancelled, String eventId) {
        if (HOTEL.equals(cancelled.getInitiatedBy())) {
            cancelledByTheHotel(cancelled, eventId);
            return;
        }
        Pending pending = pending(cancelled.getBookingId(), cancelled.getCancellationId(), "HotelReservationCancelled");
        if (pending != null) {
            complete(pending, pending.cancellation().getQuotedFee(), null, cancelled.getCancellationReference(),
                    "Cancelled by the hotel", eventId);
        }
    }

    /** The airline cancelled: its own fee is final (unless the fee was waived; then we absorb it). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void flightCancelled(FlightBookingCancelled cancelled, String eventId) {
        Pending pending = pending(cancelled.getBookingId(), cancelled.getCancellationId(), "FlightBookingCancelled");
        if (pending == null) {
            return;
        }
        Cancellation cancellation = pending.cancellation();
        BigDecimal airlineFee = EventMoney.amount(cancelled.getAirlineFee());
        BigDecimal fee = cancellation.isFeeWaived() ? BigDecimal.ZERO : airlineFee.min(cancellation.getPaidAmount());
        complete(pending, fee, airlineFee, cancelled.getCancellationReference(), "Cancelled by the airline", eventId);
        if (fee.compareTo(cancellation.getQuotedFee()) > 0) {
            Booking booking = pending.booking();
            String currency = cancellation.getCurrency();
            booking.needsAttention("REFUND_DIFFERS", "The airline charged " + Amounts.format(fee, currency)
                    + " instead of the quoted " + Amounts.format(cancellation.getQuotedFee(), currency), clock.instant());
            lifecycle.note(booking, "The airline's cancellation fee (" + Amounts.format(fee, currency)
                    + ") is higher than quoted (" + Amounts.format(cancellation.getQuotedFee(), currency)
                    + "); our support team will review it", eventId);
            log.warn("Airline fee differs from the quote reference={} quoted={} airline={}",
                    booking.getBookingReference(), cancellation.getQuotedFee(), fee);
        }
    }

    /**
     * The hotel cancelled a confirmed stay on its own (overbooking, closure; hotel manager portal): recorded as a
     * cancellation by the hotel with no fee, and everything the customer still has with us is refunded. The hotel's
     * cancellation id is the idempotency key, so a repeated event changes nothing. If the customer's own cancellation
     * is waiting for the hotel's answer, that one is completed instead, without a fee.
     */
    private void cancelledByTheHotel(HotelReservationCancelled cancelled, String eventId) {
        Booking booking = saga.lock(cancelled.getBookingId(), "HotelReservationCancelled(HOTEL)");
        if (booking == null) {
            return;
        }
        String key = "HOTEL-" + cancelled.getCancellationId();
        if (cancellations.findByBookingIdAndIdempotencyKey(booking.getId(), key).isPresent()) {
            log.info("Hotel cancellation already recorded reference={}", booking.getBookingReference());
            return;
        }
        String reason = cancelled.getReason() == null || cancelled.getReason().isBlank() ? "Cancelled by the hotel"
                : cancelled.getReason().strip();
        String reference = cancelled.getCancellationReference();
        if (booking.getStatus() == BookingStatus.CANCELLATION_PENDING) {
            cancellations.findFirstByBookingIdAndStatusOrderByRequestedAtDesc(booking.getId(), Cancellation.PENDING)
                    .ifPresent(customers -> complete(new Pending(booking, customers), BigDecimal.ZERO, null, reference,
                            "Cancelled by the hotel: " + reason, eventId));
            return;
        }
        if (booking.getStatus() != BookingStatus.CONFIRMED) {
            log.warn("Hotel cancellation ignored reference={} status={}", booking.getBookingReference(),
                    booking.getStatus());
            return;
        }
        Instant now = clock.instant();
        BigDecimal paid = booking.getTotalAmount().subtract(refunds.sumGoodwill(booking.getId())).max(BigDecimal.ZERO);
        Cancellation cancellation = cancellations.save(Cancellation.requested(new Cancellation.Request(booking.getId(),
                HOTEL, "hotel:" + cancelled.getReservationId(), reason, true, booking.getCurrency(), paid,
                BigDecimal.ZERO, paid, key, IdempotencyKeys.fingerprint(key + "|" + reason)), now));
        lifecycle.move(booking, BookingStatus.CANCELLATION_PENDING, "The hotel cancelled this stay: " + reason,
                eventId);
        complete(new Pending(booking, cancellation), BigDecimal.ZERO, null, reference, "Cancelled by the hotel",
                eventId);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void hotelCancellationFailed(HotelReservationCancellationFailed failed, String eventId) {
        rejected(failed.getBookingId(), failed.getCancellationId(), failed.getReason(), failed.getMessage(), eventId);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void flightCancellationFailed(FlightCancellationFailed failed, String eventId) {
        rejected(failed.getBookingId(), failed.getCancellationId(), failed.getReason(), failed.getMessage(), eventId);
    }

    private void complete(Pending pending, BigDecimal fee, BigDecimal supplierFee, String reference, String by,
            String eventId) {
        Booking booking = pending.booking();
        Cancellation cancellation = pending.cancellation();
        Instant now = clock.instant();
        String currency = cancellation.getCurrency();
        BigDecimal refund = cancellation.getPaidAmount().subtract(fee);
        cancellation.confirmed(fee, refund, supplierFee, reference, now);
        booking.cancelled(now);
        booking.attentionResolved("CANCELLATION_NO_ANSWER");
        lifecycle.move(booking, BookingStatus.CANCELLED, by + " (cancellation " + reference + ")"
                + (fee.signum() > 0 ? "; cancellation fee " + Amounts.format(fee, currency) : "; no cancellation fee"),
                eventId);
        events.cancelled(booking, cancellation, saga.customerName(booking), now);

        Map<String, String> details = new LinkedHashMap<>();
        details.put("bookingReference", booking.getBookingReference());
        details.put("cancellationId", cancellation.getId().toString());
        details.put("supplierReference", reference);
        details.put("cancellationFee", fee.toPlainString());
        details.put("refundAmount", refund.toPlainString());
        details.put("feeWaived", String.valueOf(cancellation.isFeeWaived()));
        if (supplierFee != null) {
            details.put("supplierFee", supplierFee.toPlainString());
        }
        audit.record("BOOKING_CANCELLED", "BOOKING", booking.getId().toString(), details);

        if (refund.signum() > 0) {
            lifecycle.move(booking, BookingStatus.REFUND_PENDING, "Refund of " + Amounts.format(refund, currency)
                    + " started", eventId);
            saga.requestRefund(booking, booking.getPaidPaymentId(), cancellation.getId(), refund,
                    RefundRequest.CANCELLATION);
        }
        log.info("Booking cancelled reference={} fee={} refund={}", booking.getBookingReference(), fee, refund);
    }

    /** The hotel or airline said no (or never confirmed): the booking stays valid, support has a look. */
    private void rejected(String bookingId, String cancellationId, String reason, String message, String eventId) {
        Pending pending = pending(bookingId, cancellationId, "CancellationFailed");
        if (pending == null) {
            return;
        }
        Booking booking = pending.booking();
        Cancellation cancellation = pending.cancellation();
        Instant now = clock.instant();
        cancellation.rejected(reason, message, now);
        lifecycle.move(booking, BookingStatus.CONFIRMED, "Cancellation not possible: " + message, eventId);
        booking.needsAttention("CANCELLATION_REJECTED", reason + ": " + message, now);
        events.cancellationFailed(booking, cancellation, saga.customerName(booking), now);
        audit.record("BOOKING_CANCELLATION_REJECTED", "BOOKING", booking.getId().toString(), Map.of(
                "bookingReference", booking.getBookingReference(),
                "cancellationId", cancellation.getId().toString(),
                "reason", reason));
        log.info("Cancellation refused reference={} reason={}", booking.getBookingReference(), reason);
    }

    private Pending pending(String bookingId, String cancellationId, String event) {
        Booking booking = saga.lock(bookingId, event);
        if (booking == null) {
            return null;
        }
        Cancellation cancellation = cancellations.findById(UUID.fromString(cancellationId)).orElse(null);
        if (cancellation == null || !cancellation.getBookingId().equals(booking.getId()) || !cancellation.isPending()
                || booking.getStatus() != BookingStatus.CANCELLATION_PENDING) {
            log.info("Ignoring {} for booking {} in status {} (cancellation {} is {})", event,
                    booking.getBookingReference(), booking.getStatus(), cancellationId,
                    cancellation == null ? "unknown" : cancellation.getStatus());
            return null;
        }
        return new Pending(booking, cancellation);
    }

    private record Pending(Booking booking, Cancellation cancellation) {
    }

    // ================================================================== reconciliation (job, one per transaction)

    /** Asks the hotel or airline again about an unanswered cancellation. @return true when it was sent again */
    @Transactional
    public boolean resendCancellation(UUID cancellationId) {
        UUID bookingId = cancellations.findBookingIdById(cancellationId).orElse(null);
        if (bookingId == null) {
            return false;
        }
        Booking booking = bookings.lockById(bookingId).orElseThrow();
        Cancellation cancellation = cancellations.findById(cancellationId).orElseThrow();
        Instant now = clock.instant();
        if (!cancellation.isPending() || cancellation.getLastSentAt().isAfter(now.minus(cancellationAfter))) {
            return false;
        }
        if (cancellation.getAttempts() >= maxAttempts) {
            if (!"CANCELLATION_NO_ANSWER".equals(booking.getAttentionReason())) {
                booking.needsAttention("CANCELLATION_NO_ANSWER", "No answer to the cancellation after "
                        + cancellation.getAttempts() + " requests", now);
                lifecycle.changed(booking);
                log.error("NEEDS ATTENTION: cancellation unanswered reference={} cancellationId={}",
                        booking.getBookingReference(), cancellationId);
            }
            return false;
        }
        cancellation.resent(now);
        events.cancellationRequested(booking, cancellation);
        log.warn("Cancellation sent again reference={} attempt={}", booking.getBookingReference(),
                cancellation.getAttempts());
        return true;
    }

    /** Asks payment-service again about an unanswered refund. @return true when it was sent again */
    @Transactional
    public boolean resendRefund(UUID refundRequestId) {
        UUID bookingId = refunds.findBookingIdById(refundRequestId).orElse(null);
        if (bookingId == null) {
            return false;
        }
        Booking booking = bookings.lockById(bookingId).orElseThrow();
        RefundRequest refund = refunds.findById(refundRequestId).orElseThrow();
        Instant now = clock.instant();
        if (!refund.isRequested() || refund.getLastSentAt().isAfter(now.minus(refundAfter))) {
            return false;
        }
        if (refund.getAttempts() >= maxAttempts) {
            if (!"REFUND_NO_ANSWER".equals(booking.getAttentionReason())) {
                booking.needsAttention("REFUND_NO_ANSWER", "No answer to the refund of "
                        + Amounts.format(refund.getAmount(), refund.getCurrency()) + " after " + refund.getAttempts()
                        + " requests", now);
                lifecycle.changed(booking);
                log.error("NEEDS ATTENTION: refund unanswered reference={} refundRequestId={}",
                        booking.getBookingReference(), refundRequestId);
            }
            return false;
        }
        refund.resent(now);
        events.refundRequested(booking, refund, saga.customerName(booking), now);
        log.warn("Refund request sent again reference={} attempt={}", booking.getBookingReference(),
                refund.getAttempts());
        return true;
    }
}
