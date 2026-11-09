package com.flighthotel.payment.repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.payment.entity.PaymentStatus;
import com.flighthotel.payment.entity.PaymentTransaction;

import jakarta.persistence.LockModeType;

public interface PaymentTransactionRepository extends JpaRepository<PaymentTransaction, UUID>, JpaSpecificationExecutor<PaymentTransaction> {

    Optional<PaymentTransaction> findByProviderOrderId(String providerOrderId);

    Optional<PaymentTransaction> findByUserIdAndIdempotencyKey(UUID userId, String idempotencyKey);

    Optional<PaymentTransaction> findFirstByBookingIdAndStatusInOrderByCreatedAtDesc(UUID bookingId,
            Collection<PaymentStatus> statuses);

    List<PaymentTransaction> findByBookingIdOrderByCreatedAtDesc(UUID bookingId);

    Page<PaymentTransaction> findByUserId(UUID userId, Pageable page);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from PaymentTransaction t where t.providerOrderId = :orderId")
    Optional<PaymentTransaction> lockByProviderOrderId(@Param("orderId") String orderId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from PaymentTransaction t where t.id = :id")
    Optional<PaymentTransaction> lockById(@Param("id") UUID id);

    @Query("select t.id from PaymentTransaction t where t.status in :statuses and t.createdAt < :before order by t.createdAt")
    List<UUID> findIdsByStatusInCreatedBefore(@Param("statuses") Collection<PaymentStatus> statuses,
            @Param("before") Instant before, Pageable page);
}
