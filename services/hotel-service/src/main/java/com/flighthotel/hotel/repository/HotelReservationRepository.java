package com.flighthotel.hotel.repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.hotel.entity.HotelReservation;
import com.flighthotel.hotel.entity.ReservationStatus;

import jakarta.persistence.LockModeType;

public interface HotelReservationRepository extends JpaRepository<HotelReservation, UUID> {

    Optional<HotelReservation> findByBookingId(UUID bookingId);

    Optional<HotelReservation> findByIdAndHotelId(UUID id, UUID hotelId);

    /** A customer's stays in the given states (reviews: which stays are completed). */
    List<HotelReservation> findByUserIdAndStatusIn(UUID userId, Collection<ReservationStatus> statuses);

    boolean existsByBookingId(UUID bookingId);

    boolean existsByConfirmationNumber(String confirmationNumber);

    boolean existsByCancellationReference(String cancellationReference);

    /** The reservation of a booking, locked until the end of the transaction (one saga step at a time). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from HotelReservation r where r.bookingId = :bookingId")
    Optional<HotelReservation> lockByBookingId(@Param("bookingId") UUID bookingId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from HotelReservation r where r.id = :id")
    Optional<HotelReservation> lockById(@Param("id") UUID id);

    /** Holds whose time ran out, oldest first. */
    @Query("""
            select r.id from HotelReservation r
            where r.status = com.flighthotel.hotel.entity.ReservationStatus.HELD and r.holdExpiresAt < :now
            order by r.holdExpiresAt""")
    List<UUID> findExpiredHolds(@Param("now") Instant now, Pageable page);
}
