package com.flighthotel.booking.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.booking.entity.HotelBooking;

public interface HotelBookingRepository extends JpaRepository<HotelBooking, UUID> {

    /** Support lookup by the hotel's confirmation number. */
    @Query("select h.bookingId from HotelBooking h where h.confirmationNumber = :number")
    List<UUID> findIdsByConfirmationNumber(@Param("number") String number);
}
