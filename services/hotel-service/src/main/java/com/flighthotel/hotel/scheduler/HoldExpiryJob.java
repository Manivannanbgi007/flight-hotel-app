package com.flighthotel.hotel.scheduler;

import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.flighthotel.hotel.reservation.ReservationService;

/**
 * "Customer never pays" (BOOKING_WORKFLOW.md §2): puts rooms whose hold ran out back on sale and tells
 * booking-service ({@code HotelInventoryReleased{EXPIRED}}). Each hold is handled in its own transaction with a row
 * lock, so several instances can run the job at the same time.
 */
@Component
public class HoldExpiryJob {

    private static final Logger log = LoggerFactory.getLogger(HoldExpiryJob.class);
    private static final int BATCH = 100;

    private final ReservationService reservations;

    public HoldExpiryJob(ReservationService reservations) {
        this.reservations = reservations;
    }

    @Scheduled(fixedDelayString = "${hotel.booking.expiry-check-interval:30s}", initialDelayString = "PT15S")
    public void releaseExpiredHolds() {
        List<UUID> expired = reservations.expiredHolds(BATCH);
        int released = 0;
        for (UUID reservationId : expired) {
            try {
                if (reservations.expire(reservationId)) {
                    released++;
                }
            } catch (RuntimeException ex) {
                // Retried on the next run.
                log.warn("Could not release expired hold reservationId={} error={}", reservationId, ex.toString());
            }
        }
        if (released > 0) {
            log.info("Expired holds released: {}", released);
        }
    }
}
