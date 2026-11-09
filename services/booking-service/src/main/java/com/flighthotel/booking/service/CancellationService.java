package com.flighthotel.booking.service;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.dto.BookingDtos.CancelRequest;
import com.flighthotel.booking.dto.BookingDtos.CancellationQuoteView;
import com.flighthotel.booking.dto.BookingDtos.CancellationView;
import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.Cancellation;
import com.flighthotel.booking.entity.SupportNote;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.CancellationRepository;
import com.flighthotel.booking.repository.FlightBookingRepository;
import com.flighthotel.booking.repository.HotelBookingRepository;
import com.flighthotel.booking.repository.RefundRequestRepository;
import com.flighthotel.booking.repository.SupportNoteRepository;
import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ForbiddenOperationException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.security.Roles;

/**
 * Step 1 of the cancellation saga (BOOKING_WORKFLOW.md section 4): quote what cancelling costs and returns, record the
 * request ({@code CANCELLATION_PENDING}) and ask the hotel or airline to cancel. Nothing is final here: the booking is
 * only cancelled when they confirm ({@link CancellationSaga}).
 * <p>
 * The owner cancels their own booking; support agents and admins ({@code BOOKING_MANAGE_ANY}) on the customer's behalf
 * with a reason; waiving the fee needs {@code REFUND_MANAGE}. Idempotent per booking and {@code Idempotency-Key}.
 */
@Service
@PreAuthorize("isAuthenticated()")
public class CancellationService {

    private static final Logger log = LoggerFactory.getLogger(CancellationService.class);
    static final String MANAGE_ANY = "BOOKING_MANAGE_ANY";
    static final String REFUND_MANAGE = "REFUND_MANAGE";

    private final BookingRepository bookings;
    private final HotelBookingRepository hotelBookings;
    private final FlightBookingRepository flightBookings;
    private final CancellationRepository cancellations;
    private final SupportNoteRepository notes;
    private final RefundRequestRepository refunds;
    private final CancellationPolicy policy;
    private final BookingLifecycle lifecycle;
    private final BookingEvents events;
    private final AuditPublisher audit;
    private final Clock clock;

    public CancellationService(BookingRepository bookings, HotelBookingRepository hotelBookings,
            FlightBookingRepository flightBookings, CancellationRepository cancellations, SupportNoteRepository notes,
            RefundRequestRepository refunds, CancellationPolicy policy, BookingLifecycle lifecycle,
            BookingEvents events, AuditPublisher audit, Clock clock) {
        this.refunds = refunds;
        this.bookings = bookings;
        this.hotelBookings = hotelBookings;
        this.flightBookings = flightBookings;
        this.cancellations = cancellations;
        this.notes = notes;
        this.policy = policy;
        this.lifecycle = lifecycle;
        this.events = events;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public CancellationQuoteView quote(UUID bookingId, boolean waiveFee) {
        AuthenticatedUser user = CurrentUser.require();
        Booking booking = bookings.findById(bookingId).filter(b -> canRead(b, user))
                .orElseThrow(() -> new ResourceNotFoundException("Booking", bookingId));
        if (waiveFee && !user.hasPermission(REFUND_MANAGE)) {
            throw new ForbiddenOperationException("Only refund managers can waive the cancellation fee.");
        }
        return view(bookingId, quote(booking, waiveFee, clock.instant()));
    }

    @Transactional
    public CancellationView cancel(UUID bookingId, CancelRequest body, String idempotencyKey) {
        AuthenticatedUser user = CurrentUser.require();
        CancelRequest request = body == null ? new CancelRequest(null, null, null) : body;
        String key = IdempotencyKeys.require(idempotencyKey);
        Booking booking = bookings.lockById(bookingId).filter(b -> canRead(b, user))
                .orElseThrow(() -> new ResourceNotFoundException("Booking", bookingId));
        boolean owner = booking.getUserId().equals(user.id());
        if (!owner && !user.hasPermission(MANAGE_ANY)) {
            throw new ForbiddenOperationException("You may view this booking but not cancel it.");
        }
        String reason = request.reason() == null || request.reason().isBlank() ? null : request.reason().strip();
        boolean waive = Boolean.TRUE.equals(request.waiveFee());
        String hash = IdempotencyKeys.fingerprint(reason + "|" + (request.expectedRefundAmount() == null ? ""
                : request.expectedRefundAmount().stripTrailingZeros().toPlainString()) + "|" + waive);

        Cancellation repeat = cancellations.findByBookingIdAndIdempotencyKey(bookingId, key).orElse(null);
        if (repeat != null) {
            if (!repeat.getRequestHash().equals(hash)) {
                throw new BusinessRuleException("IDEMPOTENCY_KEY_REUSED",
                        "This Idempotency-Key was already used for a different cancellation request.");
            }
            return view(repeat);
        }
        if (!owner && reason == null) {
            throw new BusinessRuleException("REASON_REQUIRED",
                    "Please give the reason for cancelling on the customer's behalf.", Map.of("field", "reason"));
        }
        if (waive && !user.hasPermission(REFUND_MANAGE)) {
            throw new ForbiddenOperationException("Only refund managers can waive the cancellation fee.");
        }

        Instant now = clock.instant();
        CancellationPolicy.Quote quote = quote(booking, waive, now);
        if (!quote.cancellable()) {
            throw new ApiException(HttpStatus.CONFLICT, "BOOKING_NOT_CANCELLABLE", quote.message(),
                    Map.of("reasonCode", quote.reasonCode()));
        }
        if (request.expectedRefundAmount() != null
                && request.expectedRefundAmount().compareTo(quote.refundAmount()) != 0) {
            throw new ApiException(HttpStatus.CONFLICT, "CANCELLATION_QUOTE_CHANGED",
                    "The refund for cancelling is now " + Amounts.format(quote.refundAmount(), quote.currency())
                            + ". Please check the new amount and confirm again.",
                    Map.of("refundAmount", quote.refundAmount(), "cancellationFee", quote.cancellationFee()));
        }

        String initiatedBy = owner ? "CUSTOMER" : user.hasRole(Roles.ADMIN) ? Roles.ADMIN : Roles.SUPPORT_AGENT;
        Cancellation cancellation = cancellations.save(Cancellation.requested(new Cancellation.Request(bookingId,
                initiatedBy, user.id().toString(), reason, waive, quote.currency(), quote.paidAmount(),
                quote.cancellationFee(), quote.refundAmount(), key, hash), now));
        lifecycle.move(booking, BookingStatus.CANCELLATION_PENDING, owner ? "Cancellation requested"
                : "Cancellation requested by our support team", null);
        events.cancellationRequested(booking, cancellation);
        if (!owner) {
            notes.save(new SupportNote(bookingId, "CANCELLED_ON_BEHALF", reason, user.id().toString(), initiatedBy,
                    now));
        }

        Map<String, String> details = new LinkedHashMap<>();
        details.put("bookingReference", booking.getBookingReference());
        details.put("cancellationId", cancellation.getId().toString());
        details.put("initiatedBy", initiatedBy);
        details.put("quotedFee", quote.cancellationFee().toPlainString());
        details.put("quotedRefund", quote.refundAmount().toPlainString());
        details.put("feeWaived", String.valueOf(waive));
        audit.record("BOOKING_CANCELLATION_REQUESTED", "BOOKING", bookingId.toString(), details);
        if (waive) {
            audit.record("BOOKING_CANCELLATION_FEE_WAIVED", "BOOKING", bookingId.toString(), Map.of(
                    "bookingReference", booking.getBookingReference(),
                    "cancellationId", cancellation.getId().toString(),
                    "refund", quote.refundAmount().toPlainString()));
        }
        log.info("Cancellation requested reference={} cancellationId={} by={} fee={} refund={}",
                booking.getBookingReference(), cancellation.getId(), initiatedBy, quote.cancellationFee(),
                quote.refundAmount());
        return view(cancellation);
    }

    // ------------------------------------------------------------------ helpers

    CancellationPolicy.Quote quote(Booking booking, boolean waive, Instant at) {
        return policy.quote(booking, hotelBookings.findById(booking.getId()).orElse(null),
                flightBookings.findById(booking.getId()).orElse(null), refunds.sumGoodwill(booking.getId()), waive, at);
    }

    private static boolean canRead(Booking booking, AuthenticatedUser user) {
        return booking.getUserId().equals(user.id()) || user.hasPermission(BookingQueryService.READ_ANY);
    }

    private static CancellationQuoteView view(UUID bookingId, CancellationPolicy.Quote quote) {
        return new CancellationQuoteView(bookingId, quote.cancellable(), quote.reasonCode(),
                quote.message(), quote.currency(), quote.paidAmount(), quote.cancellationFee(), quote.refundAmount(),
                quote.feeWaived(), quote.freeCancellation(), quote.freeCancellationUntil(), quote.cancelUntil(),
                quote.feeDescription(), quote.policy(), quote.quotedAt());
    }

    static CancellationView view(Cancellation c) {
        return new CancellationView(c.getId(), c.getStatus(), c.getInitiatedBy(), c.getReason(), c.isFeeWaived(),
                c.getCurrency(), c.fee(), c.refund(), c.getRequestedAt(), c.getCompletedAt(),
                c.getSupplierReference(), c.getFailureReason(), c.getFailureMessage());
    }
}
