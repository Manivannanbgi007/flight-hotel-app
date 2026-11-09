package com.flighthotel.booking.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
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
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.HotelBooking;
import com.flighthotel.booking.entity.PriceItem;
import com.flighthotel.booking.entity.RefundRequest;
import com.flighthotel.booking.repository.BookingPassengerRepository;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.HotelBookingRepository;
import com.flighthotel.booking.repository.RefundRequestRepository;
import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.hotel.GuestCheckedIn;
import com.flighthotel.events.hotel.GuestCheckedOut;
import com.flighthotel.events.hotel.HotelInventoryHeld;
import com.flighthotel.events.hotel.HotelInventoryHoldFailed;
import com.flighthotel.events.hotel.HotelInventoryReleased;
import com.flighthotel.events.hotel.HotelReservationConfirmed;
import com.flighthotel.events.hotel.HotelReservationFailed;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.events.payment.RefundFailed;

/**
 * booking-service's reactions in the hotel booking saga (BOOKING_WORKFLOW.md §2). Each handler runs in the Kafka
 * listener's transaction (with the inbox marker), locks the booking, checks that the event still fits the booking's
 * status (late and duplicate events are ignored, golden rule 5) and writes its follow-up events to the outbox.
 */
@Service
public class BookingSaga {

    private static final Logger log = LoggerFactory.getLogger(BookingSaga.class);
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    private final BookingRepository bookings;
    private final HotelBookingRepository hotelBookings;
    private final RefundRequestRepository refunds;
    private final CouponService coupons;
    private final BookingLifecycle lifecycle;
    private final BookingEvents events;
    private final Duration paymentGrace;
    private final Duration initiatedTimeout;
    private final Clock clock;

    private final BookingPassengerRepository passengers;
    private final AuditPublisher audit;

    public BookingSaga(BookingRepository bookings, HotelBookingRepository hotelBookings,
            BookingPassengerRepository passengers,
            RefundRequestRepository refunds, CouponService coupons, BookingLifecycle lifecycle, BookingEvents events,
            AuditPublisher audit, @Value("${booking.payment-grace:5m}") Duration paymentGrace,
            @Value("${booking.initiated-timeout:10m}") Duration initiatedTimeout, Clock clock) {
        this.bookings = bookings;
        this.hotelBookings = hotelBookings;
        this.passengers = passengers;
        this.refunds = refunds;
        this.coupons = coupons;
        this.lifecycle = lifecycle;
        this.events = events;
        this.audit = audit;
        this.paymentGrace = paymentGrace;
        this.initiatedTimeout = initiatedTimeout;
        this.clock = clock;
    }

    // ================================================================== hotel-service answers

    /** Rooms held at a final price: apply the coupon, fix the total, open the payment window. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void inventoryHeld(HotelInventoryHeld held, String eventId) {
        Booking booking = lock(held.getBookingId(), "HotelInventoryHeld");
        if (booking == null || !expect(booking, BookingStatus.INITIATED, "HotelInventoryHeld")) {
            // E.g. the booking already failed after waiting too long: hotel-service releases the rooms on our
            // earlier BookingFailed, which it receives after the BookingInitiated it is answering here.
            return;
        }
        Instant now = clock.instant();
        HotelBooking hotel = hotelBookings.findById(booking.getId()).orElseThrow();
        hotel.held(held);
        // Cancellation is possible until the check-in moment, which is also when the trip starts.
        Instant checkIn = CancellationPolicy.hotelCancelUntil(held.getCheckInAt(), held.getCheckIn(),
                held.getCheckInTime());
        booking.inventoryHeld(held.getHotelName(), held.getHotelCity(), held.getCheckIn(), held.getCheckOut(),
                held.getHoldExpiresAt(), held.getHoldExpiresAt().minus(paymentGrace),
                held.getDemo() ? "DEMO" : "INTERNAL", held.getCancellationPolicy(), checkIn, checkIn);

        String currency = held.getTotal().getCurrency();
        BigDecimal subtotal = EventMoney.amount(held.getSubtotal());
        BigDecimal taxes = EventMoney.amount(held.getTaxes());
        BigDecimal total = EventMoney.amount(held.getTotal());
        CouponService.Applied coupon = coupons.apply(booking, total, held.getHotelCity());

        List<PriceItem> items = new ArrayList<>();
        items.add(new PriceItem(PriceItem.ROOM, "Room charges · " + held.getNights()
                + (held.getNights() == 1 ? " night" : " nights") + " × " + held.getRooms()
                + (held.getRooms() == 1 ? " room" : " rooms"), subtotal));
        held.getTaxLines().forEach(line ->
                items.add(new PriceItem(PriceItem.TAX, line.getLabel(), EventMoney.amount(line.getAmount()))));
        if (coupon.discount().signum() > 0) {
            items.add(new PriceItem(PriceItem.DISCOUNT, "Coupon " + coupon.code(), coupon.discount().negate()));
        }
        if (coupon.note() != null) {
            booking.couponNotApplied(coupon.note());
        }
        booking.price(subtotal, taxes, coupon.discount(), currency, items);

        lifecycle.move(booking, BookingStatus.PENDING_PAYMENT, "Rooms held at the quoted price", eventId);
        events.awaitingPayment(booking, BookingEvents.describe(hotel), now);
        log.info("Booking awaiting payment reference={} total={} deadline={}", booking.getBookingReference(),
                booking.getTotalAmount(), booking.getPaymentDeadline());
    }

    /** Quote expired, sold out, price changed, ...: nothing is held, nothing was paid. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void holdFailed(HotelInventoryHoldFailed failed, String eventId) {
        Booking booking = lock(failed.getBookingId(), "HotelInventoryHoldFailed");
        if (booking == null || !expect(booking, BookingStatus.INITIATED, "HotelInventoryHoldFailed")) {
            return;
        }
        String message = failed.getMessage();
        if (failed.getNewTotal() != null) {
            message += " Today's price for the same stay is "
                    + Amounts.format(EventMoney.amount(failed.getNewTotal()), failed.getNewTotal().getCurrency())
                    + ".";
        }
        booking.failed(failed.getReason(), message, failed.getHotelName());
        lifecycle.move(booking, BookingStatus.FAILED, message, eventId);
        events.failed(booking, failed.getReason(), clock.instant());
        log.info("Booking failed reference={} reason={}", booking.getBookingReference(), failed.getReason());
    }

    /** The hotel turned the held rooms into a booking: done. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void reservationConfirmed(HotelReservationConfirmed confirmed, String eventId) {
        Booking booking = lock(confirmed.getBookingId(), "HotelReservationConfirmed");
        if (booking == null || !expect(booking, BookingStatus.SUPPLIER_PENDING, "HotelReservationConfirmed")) {
            return;
        }
        Instant now = clock.instant();
        HotelBooking hotel = hotelBookings.findById(booking.getId()).orElseThrow();
        hotel.confirmed(confirmed.getConfirmationNumber());
        booking.confirmed(now);
        coupons.consume(booking.getId());
        lifecycle.move(booking, BookingStatus.CONFIRMED, "Confirmed by the hotel", eventId);
        events.confirmed(booking, hotel, now);
        log.info("Booking confirmed reference={} confirmation={}", booking.getBookingReference(),
                confirmed.getConfirmationNumber());
    }

    /** Paid, but the hotel could not confirm (hold had expired and the rooms are gone): full refund. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void reservationFailed(HotelReservationFailed failed, String eventId) {
        Booking booking = lock(failed.getBookingId(), "HotelReservationFailed");
        if (booking == null || !expect(booking, BookingStatus.SUPPLIER_PENDING, "HotelReservationFailed")) {
            return;
        }
        booking.failed(failed.getReason(),
                "The hotel could not confirm your rooms. Your payment is being refunded in full.", null);
        coupons.release(booking.getId());
        lifecycle.move(booking, BookingStatus.REFUND_PENDING,
                "The hotel could not confirm the rooms; full refund started", eventId);
        requestRefund(booking, booking.getPaidPaymentId(), booking.getTotalAmount(), RefundRequest.BOOKING_FAILED);
    }

    /** Rooms back on sale. Only "not paid in time" needs action here; other releases were our own request. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void inventoryReleased(HotelInventoryReleased released, String eventId) {
        expireUnpaid(released.getBookingId(), released.getReason(), eventId);
    }

    /** The inventory owner (hotel or flight service) gave the held rooms or seats back. */
    void expireUnpaid(String bookingId, String reason, String eventId) {
        Booking booking = lock(bookingId, "InventoryReleased");
        if (booking == null || !"EXPIRED".equals(reason)
                || booking.getStatus() != BookingStatus.PENDING_PAYMENT) {
            // SUPPLIER_PENDING: paid in the last moment; hotel-service answers our BookingPaid next.
            return;
        }
        booking.failed("PAYMENT_TIMEOUT", "Payment was not completed in time, so the rooms were released.", null);
        coupons.release(booking.getId());
        lifecycle.move(booking, BookingStatus.EXPIRED, "Not paid in time; the rooms were released", eventId);
        events.expired(booking, clock.instant());
        log.info("Booking expired reference={}", booking.getBookingReference());
    }

    // ================================================================== payment-service answers

    @Transactional(propagation = Propagation.MANDATORY)
    public void paymentSucceeded(PaymentSucceeded payment, String eventId) {
        Booking booking = lock(payment.getBookingId(), "PaymentSucceeded");
        if (booking == null) {
            return;
        }
        UUID paymentId = UUID.fromString(payment.getPaymentId());
        BigDecimal amount = EventMoney.amount(payment.getAmount());
        if (paymentId.equals(booking.getPaidPaymentId())) {
            log.info("Payment already recorded reference={} paymentId={}", booking.getBookingReference(), paymentId);
            return;
        }
        boolean late = (booking.getStatus() == BookingStatus.EXPIRED || booking.getStatus() == BookingStatus.FAILED)
                && booking.getPaidPaymentId() == null;
        if (booking.getStatus() == BookingStatus.PENDING_PAYMENT) {
            if (amount.compareTo(booking.getTotalAmount()) != 0) {
                // payment-service charges exactly what BookingAwaitingPayment said; a difference is a bug.
                log.error("Paid amount differs from the booking total reference={} paid={} total={}",
                        booking.getBookingReference(), amount, booking.getTotalAmount());
            }
            booking.paid(paymentId);
            lifecycle.move(booking, BookingStatus.PAYMENT_SUCCESS, "Payment received", eventId);
            lifecycle.move(booking, BookingStatus.SUPPLIER_PENDING, booking.getBookingType() == BookingType.FLIGHT
                    ? "Confirming with the airline" : "Confirming with the hotel", eventId);
            events.paid(booking, clock.instant());
            log.info("Booking paid reference={} paymentId={}", booking.getBookingReference(), paymentId);
        } else if (late) {
            booking.paid(paymentId);
            String why = booking.getStatus() == BookingStatus.EXPIRED ? "expired" : "could not be completed";
            lifecycle.move(booking, BookingStatus.REFUND_PENDING,
                    "Payment arrived after the booking " + why + "; full refund started", eventId);
            requestRefund(booking, paymentId, amount, RefundRequest.LATE_PAYMENT);
        } else {
            // A second, different payment for a booking that is already paid (e.g. two browser tabs): give it back.
            lifecycle.note(booking, "A second payment of " + Amounts.format(amount, booking.getCurrency())
                    + " was received and is being refunded", eventId);
            requestRefund(booking, paymentId, amount, RefundRequest.DUPLICATE_PAYMENT);
        }
    }

    /** The customer may try again until the payment deadline; the booking keeps its status. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void paymentFailed(PaymentFailed failed, String eventId) {
        Booking booking = lock(failed.getBookingId(), "PaymentFailed");
        if (booking == null || booking.getStatus() != BookingStatus.PENDING_PAYMENT) {
            return;
        }
        booking.paymentFailed();
        String reason = failed.getFailureReason() == null ? "" : ": " + failed.getFailureReason();
        lifecycle.note(booking, "Payment failed" + reason + ". You can try again.", eventId);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void refundCompleted(RefundCompleted completed, String eventId) {
        RefundRequest refund = refunds.findById(UUID.fromString(completed.getRefundRequestId())).orElse(null);
        if (refund == null) {
            log.warn("RefundCompleted for unknown refund request {}", completed.getRefundRequestId());
            return;
        }
        Booking booking = lock(refund.getBookingId().toString(), "RefundCompleted");
        if (!refund.isRequested()) {
            // payment-service repeats its answer when asked again (reconciliation): count the money once.
            log.info("Refund request already {} refundRequestId={}", refund.getStatus(), refund.getId());
            return;
        }
        refund.completed(clock.instant());
        String text = "Refund of " + Amounts.format(refund.getAmount(), refund.getCurrency()) + " completed";
        booking.attentionResolved("REFUND_FAILED", "REFUND_NO_ANSWER");
        if (refund.refundsTheBooking()) {
            booking.refundCompleted(refund.getAmount());
        }
        // A goodwill refund never ends the booking's own refund (it may complete while a cancellation refund waits).
        if (refund.refundsTheBooking() && !refund.isGoodwill() && booking.getStatus() == BookingStatus.REFUND_PENDING) {
            lifecycle.move(booking, BookingStatus.REFUNDED, text, eventId);
        } else {
            lifecycle.note(booking, text, eventId);
        }
        audit.record("BOOKING_REFUND_COMPLETED", "BOOKING", booking.getId().toString(), Map.of(
                "bookingReference", booking.getBookingReference(),
                "refundRequestId", refund.getId().toString(),
                "amount", refund.getAmount().toPlainString(),
                "reason", refund.getReason(),
                "paymentStatus", booking.getPaymentStatus().name()));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void refundFailed(RefundFailed failed, String eventId) {
        RefundRequest refund = refunds.findById(UUID.fromString(failed.getRefundRequestId())).orElse(null);
        if (refund == null) {
            log.warn("RefundFailed for unknown refund request {}", failed.getRefundRequestId());
            return;
        }
        Booking booking = lock(refund.getBookingId().toString(), "RefundFailed");
        if (!refund.isRequested()) {
            log.info("Refund request already {} refundRequestId={}", refund.getStatus(), refund.getId());
            return;
        }
        refund.failed(failed.getReason());
        booking.needsAttention("REFUND_FAILED", "Refund of " + Amounts.format(refund.getAmount(), refund.getCurrency())
                + " failed: " + failed.getReason(), clock.instant());
        lifecycle.note(booking, "The refund could not be processed yet; our support team will follow up", eventId);
        audit.record("BOOKING_REFUND_FAILED", "BOOKING", booking.getId().toString(), Map.of(
                "bookingReference", booking.getBookingReference(),
                "refundRequestId", refund.getId().toString(),
                "amount", refund.getAmount().toPlainString(),
                "reason", refund.getReason()));
        log.error("Refund failed reference={} refundRequestId={} reason={}", booking.getBookingReference(),
                refund.getId(), failed.getReason());
    }

    // ================================================================== the hotel's front desk (Phase 9)

    /** Shown on the timeline; the booking stays confirmed. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void guestCheckedIn(GuestCheckedIn checkedIn, String eventId) {
        Booking booking = lock(checkedIn.getBookingId(), "GuestCheckedIn");
        if (booking != null && expect(booking, BookingStatus.CONFIRMED, "GuestCheckedIn")) {
            lifecycle.note(booking, "Checked in at the hotel", eventId);
        }
    }

    /** The hotel checked the guests out (also early): the stay is completed now, not at the nightly job. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void guestCheckedOut(GuestCheckedOut checkedOut, String eventId) {
        Booking booking = lock(checkedOut.getBookingId(), "GuestCheckedOut");
        if (booking == null || !expect(booking, BookingStatus.CONFIRMED, "GuestCheckedOut")) {
            return;
        }
        lifecycle.move(booking, BookingStatus.COMPLETED, "Checked out: stay completed", eventId);
        events.completed(booking, clock.instant());
        log.info("Booking completed at check-out reference={}", booking.getBookingReference());
    }

    // ================================================================== jobs

    /** hotel-service never answered (outage): give up so the customer is not left waiting. Nothing was paid. */
    @Transactional
    public boolean failUnanswered(UUID bookingId) {
        Booking booking = bookings.lockById(bookingId).orElse(null);
        Instant now = clock.instant();
        if (booking == null || booking.getStatus() != BookingStatus.INITIATED
                || booking.getCreatedAt().isAfter(now.minus(initiatedTimeout))) {
            return false;
        }
        String message = "We could not get an answer from the hotel in time. Nothing was charged; please try again.";
        booking.failed("NO_RESPONSE", message, null);
        lifecycle.move(booking, BookingStatus.FAILED, message, null);
        // If hotel-service holds the rooms later, this tells it to release them again.
        events.failed(booking, "NO_RESPONSE", now);
        return true;
    }

    /** After check-out the stay is completed. */
    @Transactional
    public boolean complete(UUID bookingId) {
        Booking booking = bookings.lockById(bookingId).orElse(null);
        LocalDate today = LocalDate.now(clock.withZone(INDIA));
        if (booking == null || booking.getStatus() != BookingStatus.CONFIRMED || booking.getEndDate() == null
                || !booking.getEndDate().isBefore(today)) {
            return false;
        }
        lifecycle.move(booking, BookingStatus.COMPLETED, "Stay completed", null);
        events.completed(booking, clock.instant());
        return true;
    }

    // ================================================================== helpers

    void requestRefund(Booking booking, UUID paymentId, BigDecimal amount, String reason) {
        requestRefund(booking, paymentId, null, amount, reason);
    }

    /** Money back to the customer: a refund request (its id is payment-service's idempotency key) and its event. */
    RefundRequest requestRefund(Booking booking, UUID paymentId, UUID cancellationId, BigDecimal amount,
            String reason) {
        return requestRefund(booking, new RefundRequest(booking.getId(), paymentId, cancellationId, amount,
                booking.getCurrency(), reason, clock.instant()));
    }

    /** Sends a prepared refund request (e.g. a goodwill refund with its Idempotency-Key). */
    RefundRequest requestRefund(Booking booking, RefundRequest request) {
        RefundRequest refund = refunds.save(request);
        UUID paymentId = refund.getPaymentId();
        BigDecimal amount = refund.getAmount();
        String reason = refund.getReason();
        // A goodwill refund leaves the booking as it is ("paid") until the money is back (then "partially refunded").
        if (refund.refundsTheBooking() && !refund.isGoodwill()) {
            booking.refundPending();
        }
        events.refundRequested(booking, refund, customerName(booking), clock.instant());
        audit.record("BOOKING_REFUND_REQUESTED", "BOOKING", booking.getId().toString(), Map.of(
                "bookingReference", booking.getBookingReference(),
                "refundRequestId", refund.getId().toString(),
                "paymentId", paymentId.toString(),
                "amount", amount.toPlainString(),
                "reason", reason));
        log.info("Refund requested reference={} amount={} reason={}", booking.getBookingReference(), amount, reason);
        return refund;
    }

    /** The lead guest or first passenger, for greetings; the contact e-mail if neither is known. */
    String customerName(Booking booking) {
        String lead = leadName(booking);
        return lead != null ? lead : booking.getContactEmail();
    }

    String leadName(Booking booking) {
        return hotelBookings.findById(booking.getId()).map(hotel -> hotel.leadGuest().fullName())
                .or(() -> passengers.findByBookingIdOrderByPassengerNo(booking.getId()).stream().findFirst()
                        .map(passenger -> passenger.fullName()))
                .orElse(null);
    }

    Booking lock(String bookingId, String event) {
        Booking booking = bookings.lockById(UUID.fromString(bookingId)).orElse(null);
        if (booking == null) {
            log.warn("{} for unknown booking {}", event, bookingId);
        }
        return booking;
    }

    static boolean expect(Booking booking, BookingStatus expected, String event) {
        if (booking.getStatus() != expected) {
            log.info("Ignoring {} for booking {} in status {} (expected {})", event, booking.getBookingReference(),
                    booking.getStatus(), expected);
            return false;
        }
        return true;
    }
}
