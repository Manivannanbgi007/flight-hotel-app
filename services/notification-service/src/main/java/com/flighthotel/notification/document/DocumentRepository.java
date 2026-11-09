package com.flighthotel.notification.document;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface DocumentRepository extends JpaRepository<Document, UUID> {

    List<Document> findByBookingIdOrderByCreatedAtAscIdAsc(UUID bookingId);

    List<Document> findByBookingIdAndUserIdOrderByCreatedAtAscIdAsc(UUID bookingId, UUID userId);
}
