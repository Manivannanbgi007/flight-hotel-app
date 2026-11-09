package com.flighthotel.booking.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.booking.entity.CouponUsage;

public interface CouponUsageRepository extends JpaRepository<CouponUsage, UUID> {

    Optional<CouponUsage> findByBookingId(UUID bookingId);

    long countByCouponIdAndUserIdAndStatusIn(UUID couponId, UUID userId, Collection<String> statuses);

    /** Rows of {@code [couponId, status, count]} for the admin list (reserved and consumed uses). */
    @Query("select u.couponId, u.status, count(u) from CouponUsage u where u.couponId in :ids "
            + "group by u.couponId, u.status")
    List<Object[]> countByStatus(@Param("ids") Collection<UUID> ids);
}
