package com.flighthotel.payment.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.payment.entity.Refund;

import jakarta.persistence.LockModeType;

public interface RefundRepository extends JpaRepository<Refund, UUID>, JpaSpecificationExecutor<Refund> {

    Optional<Refund> findByIdempotencyKey(String idempotencyKey);

    List<Refund> findByPaymentIdOrderByCreatedAt(UUID paymentId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Refund r where r.providerRefundId = :providerRefundId")
    Optional<Refund> lockByProviderRefundId(@Param("providerRefundId") String providerRefundId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Refund r where r.id = :id")
    Optional<Refund> lockById(@Param("id") UUID id);

    /** Refunds already promised to the provider but not finished: they reduce what can still be refunded. */
    @Query("select coalesce(sum(r.amount), 0) from Refund r where r.paymentId = :paymentId "
            + "and r.status = com.flighthotel.payment.entity.Refund.Status.PENDING")
    java.math.BigDecimal sumPendingByPaymentId(@Param("paymentId") UUID paymentId);

    @Query("select r.id from Refund r where r.status = com.flighthotel.payment.entity.Refund.Status.PENDING "
            + "and r.createdAt < :before order by r.createdAt")
    List<UUID> findPendingIdsCreatedBefore(@Param("before") Instant before, Pageable page);
}
