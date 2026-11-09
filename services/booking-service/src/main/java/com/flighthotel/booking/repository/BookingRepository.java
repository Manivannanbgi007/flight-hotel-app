package com.flighthotel.booking.repository;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingStatus;

import jakarta.persistence.LockModeType;

public interface BookingRepository extends JpaRepository<Booking, UUID>, JpaSpecificationExecutor<Booking> {

    Optional<Booking> findByUserIdAndIdempotencyKey(UUID userId, String idempotencyKey);

    boolean existsByBookingReference(String bookingReference);

    Page<Booking> findByUserIdAndStatusIn(UUID userId, Collection<BookingStatus> statuses, Pageable page);

    /** The booking, locked until the end of the transaction: saga steps for one booking never interleave. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from Booking b where b.id = :id")
    Optional<Booking> lockById(@Param("id") UUID id);

    @Query("select b.id from Booking b where b.status = :status and b.createdAt < :before order by b.createdAt")
    List<UUID> findIdsByStatusCreatedBefore(@Param("status") BookingStatus status, @Param("before") Instant before,
            Pageable page);

    /** Keyset pages over all bookings (the snapshot backfill). */
    @Query("select b.id from Booking b order by b.id")
    List<UUID> findIdsOrderById(Pageable page);

    @Query("select b.id from Booking b where b.id > :after order by b.id")
    List<UUID> findIdsAfter(@Param("after") UUID after, Pageable page);

    @Query("select b.id from Booking b where b.status = :status and b.endDate < :date order by b.endDate")
    List<UUID> findIdsByStatusEndingBefore(@Param("status") BookingStatus status, @Param("date") LocalDate date,
            Pageable page);
}
