package com.flighthotel.flight.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.flight.entity.SupplierBooking;

import jakarta.persistence.LockModeType;

public interface SupplierBookingRepository extends JpaRepository<SupplierBooking, UUID> {

    boolean existsByBookingId(UUID bookingId);

    Optional<SupplierBooking> findByBookingId(UUID bookingId);

    /** Locked until the end of the transaction: hold, payment, expiry and reconciliation never interleave. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from SupplierBooking b where b.bookingId = :bookingId")
    Optional<SupplierBooking> lockByBookingId(@Param("bookingId") UUID bookingId);

    @Query("select b.bookingId from SupplierBooking b where b.status = 'HELD' and b.holdExpiresAt < :now "
            + "order by b.holdExpiresAt")
    List<UUID> findExpiredHolds(@Param("now") Instant now, Pageable page);

    @Query("select b.bookingId from SupplierBooking b where b.status = 'UNCERTAIN' and b.nextReconcileAt <= :now "
            + "order by b.nextReconcileAt")
    List<UUID> findDueForReconciliation(@Param("now") Instant now, Pageable page);

    @Query("select b.bookingId from SupplierBooking b where b.status = 'CANCEL_UNCERTAIN' and b.nextReconcileAt <= :now "
            + "order by b.nextReconcileAt")
    List<UUID> findCancellationsDueForReconciliation(@Param("now") Instant now, Pageable page);
}
