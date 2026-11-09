package com.flighthotel.booking.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.booking.entity.BookingStatusChange;

public interface BookingStatusChangeRepository extends JpaRepository<BookingStatusChange, UUID> {

    /** Oldest first; the id (UUIDv7) breaks ties between changes in the same microsecond. */
    List<BookingStatusChange> findByBookingIdOrderByChangedAtAscIdAsc(UUID bookingId);
}
