package com.flighthotel.booking.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.booking.entity.Coupon;

import jakarta.persistence.LockModeType;

public interface CouponRepository extends JpaRepository<Coupon, UUID> {

    Optional<Coupon> findByCode(String code);

    @Query("select c from Coupon c where (:status is null or c.status = :status) and (:q is null "
            + "or lower(c.code) like :q or lower(c.title) like :q)")
    Page<Coupon> search(@Param("q") String q, @Param("status") String status, Pageable page);

    boolean existsByCode(String code);

    /** Locked while its usage is counted, so the limits hold under concurrent bookings. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Coupon c where c.code = :code")
    Optional<Coupon> lockByCode(@Param("code") String code);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Coupon c where c.id = :id")
    Optional<Coupon> lockById(@Param("id") UUID id);
}
