package com.flighthotel.booking.repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.booking.entity.RefundRequest;

public interface RefundRequestRepository extends JpaRepository<RefundRequest, UUID> {

    List<RefundRequest> findByBookingIdOrderByRequestedAtAsc(UUID bookingId);

    Optional<RefundRequest> findByBookingIdAndIdempotencyKey(UUID bookingId, String idempotencyKey);

    /**
     * Money of the booking itself that is back with the customer or on its way (not failed): extra, duplicate payments
     * are not the booking's money.
     */
    @Query("select coalesce(sum(r.amount), 0) from RefundRequest r where r.bookingId = :bookingId "
            + "and r.reason <> 'DUPLICATE_PAYMENT' and r.status <> 'FAILED'")
    BigDecimal sumRefundingTheBooking(@Param("bookingId") UUID bookingId);

    /** Goodwill refunds of the booking that are done or on their way: a later cancellation refunds only the rest. */
    @Query("select coalesce(sum(r.amount), 0) from RefundRequest r where r.bookingId = :bookingId "
            + "and r.reason = 'GOODWILL' and r.status <> 'FAILED'")
    BigDecimal sumGoodwill(@Param("bookingId") UUID bookingId);

    Optional<RefundRequest> findFirstByBookingIdOrderByRequestedAtDesc(UUID bookingId);

    /** Only the booking id (nothing loaded): the booking is locked before the refund request is read. */
    @Query("select r.bookingId from RefundRequest r where r.id = :id")
    Optional<UUID> findBookingIdById(@Param("id") UUID id);

    /** Refund requests payment-service has not answered since {@code before} (reconciliation). */
    @Query("select r.id from RefundRequest r where r.status = 'REQUESTED' and r.lastSentAt < :before "
            + "order by r.lastSentAt")
    List<UUID> findRequestedSentBefore(@Param("before") Instant before, Pageable page);
}
