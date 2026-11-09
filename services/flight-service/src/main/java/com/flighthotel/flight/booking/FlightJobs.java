package com.flighthotel.flight.booking;

import java.time.Clock;
import java.util.List;
import java.util.UUID;
import java.util.function.Predicate;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.flighthotel.flight.repository.SupplierBookingRepository;

/**
 * BOOKING_WORKFLOW.md section 6: release expired seat holds and resolve unknown supplier outcomes (orders and
 * cancellations), every minute.
 */
@Component
public class FlightJobs {

    private static final Logger log = LoggerFactory.getLogger(FlightJobs.class);
    private static final int BATCH = 100;

    private final SupplierBookingRepository bookings;
    private final HoldService holds;
    private final CancellationService cancellations;
    private final Clock clock;

    public FlightJobs(SupplierBookingRepository bookings, HoldService holds, CancellationService cancellations,
            Clock clock) {
        this.bookings = bookings;
        this.holds = holds;
        this.cancellations = cancellations;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${flight.jobs.expiry-interval:60s}", initialDelayString = "PT30S")
    public void releaseExpiredHolds() {
        run("seat holds released", bookings.findExpiredHolds(clock.instant(), PageRequest.ofSize(BATCH)),
                holds::expire);
    }

    @Scheduled(fixedDelayString = "${flight.jobs.reconcile-interval:60s}", initialDelayString = "PT45S")
    public void reconcileUncertainBookings() {
        run("uncertain bookings settled", bookings.findDueForReconciliation(clock.instant(),
                PageRequest.ofSize(BATCH)), holds::reconcile);
        run("unanswered cancellations settled", bookings.findCancellationsDueForReconciliation(clock.instant(),
                PageRequest.ofSize(BATCH)), cancellations::reconcile);
    }

    /** Each booking in its own transaction with a row lock, so several instances can run the jobs together. */
    public static void run(String what, List<UUID> ids, Predicate<UUID> action) {
        int done = 0;
        for (UUID id : ids) {
            try {
                if (action.test(id)) {
                    done++;
                }
            } catch (RuntimeException ex) {
                log.warn("Flight job failed for bookingId={} error={}", id, ex.toString());
            }
        }
        if (done > 0) {
            log.info("Flight job: {} {}", done, what);
        }
    }
}
