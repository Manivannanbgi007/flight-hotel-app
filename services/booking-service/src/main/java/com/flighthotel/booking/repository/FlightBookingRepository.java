package com.flighthotel.booking.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.booking.entity.FlightBooking;

public interface FlightBookingRepository extends JpaRepository<FlightBooking, UUID> {

    /** Support lookup by the airline's PNR. */
    @Query("select f.bookingId from FlightBooking f where f.pnr = :pnr")
    List<UUID> findIdsByPnr(@Param("pnr") String pnr);
}
