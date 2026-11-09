package com.flighthotel.payment.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.payment.entity.PayableBooking;

import jakarta.persistence.LockModeType;

public interface PayableBookingRepository extends JpaRepository<PayableBooking, UUID> {

    Optional<PayableBooking> findByBookingReference(String bookingReference);

    /** Locked until the end of the transaction: order creation and payment results of one booking never interleave. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PayableBooking p where p.bookingId = :id")
    Optional<PayableBooking> lockById(@Param("id") UUID id);
}
