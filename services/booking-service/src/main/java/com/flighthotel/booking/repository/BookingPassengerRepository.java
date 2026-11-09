package com.flighthotel.booking.repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.booking.entity.BookingPassenger;

public interface BookingPassengerRepository extends JpaRepository<BookingPassenger, UUID> {

    List<BookingPassenger> findByBookingIdOrderByPassengerNo(UUID bookingId);

    /** The travellers of many bookings in one query (My Trips cards). */
    List<BookingPassenger> findByBookingIdInOrderByBookingIdAscPassengerNoAsc(Collection<UUID> bookingIds);
}
