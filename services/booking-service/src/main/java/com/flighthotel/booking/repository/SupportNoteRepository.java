package com.flighthotel.booking.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.booking.entity.SupportNote;

public interface SupportNoteRepository extends JpaRepository<SupportNote, UUID> {

    List<SupportNote> findByBookingIdOrderByCreatedAtAscIdAsc(UUID bookingId);
}
