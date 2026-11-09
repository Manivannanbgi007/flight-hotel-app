package com.flighthotel.booking.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.booking.entity.Cancellation;

public interface CancellationRepository extends JpaRepository<Cancellation, UUID> {

    Optional<Cancellation> findFirstByBookingIdAndStatusOrderByRequestedAtDesc(UUID bookingId, String status);

    Optional<Cancellation> findByBookingIdAndIdempotencyKey(UUID bookingId, String idempotencyKey);

    Optional<Cancellation> findFirstByBookingIdOrderByRequestedAtDesc(UUID bookingId);

    /** Only the booking id (nothing loaded): the booking is locked before the cancellation is read. */
    @Query("select c.bookingId from Cancellation c where c.id = :id")
    Optional<UUID> findBookingIdById(@Param("id") UUID id);

    /** Cancellations the hotel or airline has not answered since {@code before} (reconciliation). */
    @Query("select c.id from Cancellation c where c.status = 'PENDING' and c.lastSentAt < :before "
            + "order by c.lastSentAt")
    List<UUID> findPendingSentBefore(@Param("before") Instant before, Pageable page);
}
