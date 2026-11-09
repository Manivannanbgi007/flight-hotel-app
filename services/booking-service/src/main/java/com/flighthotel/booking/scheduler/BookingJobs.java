package com.flighthotel.booking.scheduler;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import java.util.function.Predicate;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.CancellationRepository;
import com.flighthotel.booking.repository.RefundRequestRepository;
import com.flighthotel.booking.service.BookingSaga;
import com.flighthotel.booking.service.CancellationSaga;

/**
 * Housekeeping of BOOKING_WORKFLOW.md §6. Each booking is handled in its own transaction with a row lock, so several
 * instances may run the jobs at the same time.
 */
@Component
public class BookingJobs {

    private static final Logger log = LoggerFactory.getLogger(BookingJobs.class);
    private static final int BATCH = 100;

    private final BookingRepository bookings;
    private final CancellationRepository cancellations;
    private final RefundRequestRepository refunds;
    private final BookingSaga saga;
    private final CancellationSaga cancellationSaga;
    private final Duration initiatedTimeout;
    private final Duration cancellationAfter;
    private final Duration refundAfter;
    private final Clock clock;

    public BookingJobs(BookingRepository bookings, CancellationRepository cancellations,
            RefundRequestRepository refunds, BookingSaga saga, CancellationSaga cancellationSaga,
            @Value("${booking.initiated-timeout:10m}") Duration initiatedTimeout,
            @Value("${booking.reconcile.cancellation-after:10m}") Duration cancellationAfter,
            @Value("${booking.reconcile.refund-after:30m}") Duration refundAfter, Clock clock) {
        this.bookings = bookings;
        this.cancellations = cancellations;
        this.refunds = refunds;
        this.saga = saga;
        this.cancellationSaga = cancellationSaga;
        this.initiatedTimeout = initiatedTimeout;
        this.cancellationAfter = cancellationAfter;
        this.refundAfter = refundAfter;
        this.clock = clock;
    }

    /** Bookings hotel-service never answered (it was down for longer than the timeout). */
    @Scheduled(fixedDelayString = "${booking.jobs.unanswered-check-interval:60s}", initialDelayString = "PT30S")
    public void failUnansweredBookings() {
        List<UUID> stuck = bookings.findIdsByStatusCreatedBefore(BookingStatus.INITIATED,
                clock.instant().minus(initiatedTimeout), PageRequest.ofSize(BATCH));
        run("unanswered bookings failed", stuck, saga::failUnanswered);
    }

    /** CONFIRMED to COMPLETED once the stay is over. */
    @Scheduled(cron = "${booking.jobs.complete-cron:0 15 * * * *}", zone = "Asia/Kolkata")
    public void completePastTrips() {
        LocalDate today = LocalDate.now(clock.withZone(ZoneId.of("Asia/Kolkata")));
        run("trips completed", bookings.findIdsByStatusEndingBefore(BookingStatus.CONFIRMED, today,
                PageRequest.ofSize(BATCH)), saga::complete);
    }

    /**
     * Cancellations the hotel or airline did not answer, and refunds payment-service did not answer, are sent again
     * (the answers are repeatable); after a few tries the booking goes to the support "Needs attention" queue.
     */
    @Scheduled(fixedDelayString = "${booking.jobs.reconcile-interval:5m}", initialDelayString = "PT2M")
    public void reconcileCancellationsAndRefunds() {
        run("cancellations asked again", cancellations.findPendingSentBefore(clock.instant().minus(cancellationAfter),
                PageRequest.ofSize(BATCH)), cancellationSaga::resendCancellation);
        run("refund requests asked again", refunds.findRequestedSentBefore(clock.instant().minus(refundAfter),
                PageRequest.ofSize(BATCH)), cancellationSaga::resendRefund);
    }

    private static void run(String what, List<UUID> ids, Predicate<UUID> action) {
        int done = 0;
        for (UUID id : ids) {
            try {
                if (action.test(id)) {
                    done++;
                }
            } catch (RuntimeException ex) {
                log.warn("Booking job failed for bookingId={} error={}", id, ex.toString());
            }
        }
        if (done > 0) {
            log.info("Booking job: {} {}", done, what);
        }
    }
}
