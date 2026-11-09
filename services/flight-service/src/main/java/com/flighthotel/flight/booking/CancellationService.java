package com.flighthotel.flight.booking;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.events.booking.BookingCancellationRequested;
import com.flighthotel.flight.config.FlightProperties;
import com.flighthotel.flight.entity.SupplierBooking;
import com.flighthotel.flight.integration.FlightModel.SupplierCancellation;
import com.flighthotel.flight.integration.FlightModel.SupplierException;
import com.flighthotel.flight.integration.FlightModel.SupplierRejectedException;
import com.flighthotel.flight.integration.FlightProviders.FlightBookingProvider;
import com.flighthotel.flight.repository.SupplierBookingRepository;
import com.flighthotel.flight.service.ProviderRegistry;

/**
 * flight-service's part of the cancellation saga (BOOKING_WORKFLOW.md section 4): cancel the issued order at the airline
 * and report the airline's own fee. A cancellation the airline does not answer is never sent again blindly; it is looked
 * up (reconciliation) until it is found or known not to have happened.
 */
@Service
public class CancellationService {

    private static final Logger log = LoggerFactory.getLogger(CancellationService.class);
    static final String NO_ANSWER_MESSAGE = "The airline did not confirm the cancellation, so your booking is still "
            + "valid. Please try again later or contact support.";

    private final SupplierBookingRepository bookings;
    private final ProviderRegistry providers;
    private final FlightEvents events;
    private final AuditPublisher audit;
    private final FlightProperties properties;
    private final Clock clock;

    public CancellationService(SupplierBookingRepository bookings, ProviderRegistry providers, FlightEvents events,
            AuditPublisher audit, FlightProperties properties, Clock clock) {
        this.bookings = bookings;
        this.providers = providers;
        this.events = events;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    /** {@code BookingCancellationRequested}: cancel the issued order, or say why not. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void cancel(BookingCancellationRequested request) {
        UUID bookingId = UUID.fromString(request.getBookingId());
        String cancellationId = request.getCancellationId();
        Instant now = clock.instant();
        SupplierBooking booking = bookings.lockByBookingId(bookingId).orElse(null);
        if (booking == null) {
            events.cancellationFailed(bookingId, cancellationId, "NOT_CANCELLABLE",
                    "The airline has no issued booking to cancel.", now);
            return;
        }
        switch (booking.getStatus()) {
            case SupplierBooking.CANCELLED -> {
                log.info("Flight booking already cancelled, repeating the answer bookingId={}", bookingId);
                events.cancelled(booking);
            }
            case SupplierBooking.CANCEL_UNCERTAIN ->
                    // The airline has not answered the first request yet: reconciliation answers, never cancel twice.
                    log.info("Cancellation still being checked with the airline bookingId={}", bookingId);
            case SupplierBooking.CONFIRMED -> cancelAtAirline(booking, cancellationId, request.getInitiatedBy(), now);
            default -> {
                events.cancellationFailed(bookingId, cancellationId, "NOT_CANCELLABLE",
                        "The airline has no issued booking to cancel.", now);
                log.warn("Cancellation refused bookingId={} status={}", bookingId, booking.getStatus());
            }
        }
    }

    private void cancelAtAirline(SupplierBooking booking, String cancellationId, String initiatedBy, Instant now) {
        FlightBookingProvider provider = providers.bookingProvider(booking.getProviderCode());
        try {
            SupplierCancellation cancellation = provider.cancelOrder(booking.getSupplierOrderId(), cancellationId);
            cancelled(booking, cancellationId, cancellation, initiatedBy);
        } catch (SupplierRejectedException ex) {
            events.cancellationFailed(booking.getBookingId(), cancellationId, ex.getCode(), ex.getMessage(), now);
            log.info("Airline refused the cancellation bookingId={} code={}", booking.getBookingId(), ex.getCode());
        } catch (SupplierException ex) {
            booking.cancelUncertain(cancellationId, now, now.plus(HoldService.backoff(1)));
            log.warn("Airline did not answer the cancellation, outcome unknown bookingId={} code={}",
                    booking.getBookingId(), ex.getCode());
        }
    }

    /** Looks an unanswered cancellation up at the airline. @return true when it was settled */
    @Transactional
    public boolean reconcile(UUID bookingId) {
        Instant now = clock.instant();
        SupplierBooking booking = bookings.lockByBookingId(bookingId).orElse(null);
        if (booking == null || !SupplierBooking.CANCEL_UNCERTAIN.equals(booking.getStatus())
                || booking.getNextReconcileAt() == null || booking.getNextReconcileAt().isAfter(now)) {
            return false;
        }
        FlightBookingProvider provider = providers.bookingProvider(booking.getProviderCode());
        FlightProperties.Reconcile rules = properties.reconcile();
        try {
            Optional<SupplierCancellation> found = provider.findCancellation(booking.getSupplierOrderId());
            if (found.isPresent()) {
                cancelled(booking, booking.getCancellationId(), found.get(), "SYSTEM");
                return true;
            }
            booking.looked(now.plus(HoldService.backoff(booking.getAttempts() + 1)), "NOT_FOUND");
            if (booking.getAttempts() >= rules.maxAttempts()
                    && !now.isBefore(booking.getUncertainSince().plus(rules.notFoundAfter()))) {
                String cancellationId = booking.getCancellationId();
                booking.cancellationNotConfirmed();
                events.cancellationFailed(bookingId, cancellationId, "SUPPLIER_NO_ANSWER", NO_ANSWER_MESSAGE, now);
                log.warn("Airline has no cancellation after {} looks; the booking stays valid bookingId={}",
                        booking.getAttempts(), bookingId);
                return true;
            }
        } catch (SupplierException ex) {
            booking.looked(now.plus(HoldService.backoff(booking.getAttempts() + 1)), ex.getCode());
            log.warn("Airline look-up of the cancellation failed bookingId={} code={}", bookingId, ex.getCode());
        }
        return false;
    }

    private void cancelled(SupplierBooking booking, String cancellationId, SupplierCancellation cancellation,
            String initiatedBy) {
        booking.cancelled(cancellationId, cancellation.cancellationRef(), cancellation.penalty(), cancellation.refund(),
                cancellation.cancelledAt());
        events.cancelled(booking);
        audit.record("FLIGHT_ORDER_CANCELLED", "FLIGHT_BOOKING", booking.getBookingId().toString(), Map.of(
                "supplierOrderId", booking.getSupplierOrderId(),
                "provider", booking.getProviderCode(),
                "cancellationId", cancellationId,
                "cancellationReference", cancellation.cancellationRef(),
                "airlineFee", cancellation.penalty().toPlainString(),
                "airlineRefund", cancellation.refund().toPlainString(),
                "initiatedBy", initiatedBy));
        log.info("Flight booking cancelled bookingId={} reference={} airlineFee={}", booking.getBookingId(),
                cancellation.cancellationRef(), cancellation.penalty());
    }
}
