package com.flighthotel.payment.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.payment.entity.Invoice;

public interface InvoiceRepository extends JpaRepository<Invoice, UUID> {

    Optional<Invoice> findByBookingId(UUID bookingId);

    boolean existsByBookingId(UUID bookingId);

    java.util.List<Invoice> findByBookingIdIn(java.util.Collection<UUID> bookingIds);

    Page<Invoice> findByUserId(UUID userId, Pageable page);
}
