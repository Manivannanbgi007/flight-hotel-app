package com.flighthotel.hotel.repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.hotel.entity.ReviewReport;

public interface ReviewReportRepository extends JpaRepository<ReviewReport, UUID> {

    boolean existsByReviewIdAndReporterId(UUID reviewId, UUID reporterId);

    List<ReviewReport> findByReviewIdInAndStatusOrderByCreatedAtAsc(Collection<UUID> reviewIds, String status);

    /** The moderator decided on the review: its open reports are done. @return how many were open */
    @Modifying(flushAutomatically = true, clearAutomatically = false)
    @Query("""
            update ReviewReport r set r.status = com.flighthotel.hotel.entity.ReviewReport.CLOSED, r.closedAt = :now
            where r.reviewId = :reviewId and r.status = com.flighthotel.hotel.entity.ReviewReport.OPEN""")
    int closeOpenReports(@Param("reviewId") UUID reviewId, @Param("now") Instant now);
}
