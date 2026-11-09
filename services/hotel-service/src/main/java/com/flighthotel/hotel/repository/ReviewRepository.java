package com.flighthotel.hotel.repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.hotel.entity.Review;
import com.flighthotel.hotel.entity.ReviewStatus;

public interface ReviewRepository extends JpaRepository<Review, UUID>, JpaSpecificationExecutor<Review> {

    boolean existsByBookingId(UUID bookingId);

    Page<Review> findByUserId(UUID userId, Pageable pageable);

    Page<Review> findByHotelIdAndStatus(UUID hotelId, ReviewStatus status, Pageable pageable);

    Page<Review> findByHotelId(UUID hotelId, Pageable pageable);

    @Query("select r.bookingId from Review r where r.userId = :userId and r.bookingId in :bookingIds")
    List<UUID> findReviewedBookingIds(@Param("userId") UUID userId, @Param("bookingIds") Collection<UUID> bookingIds);

    /** Approved reviews per star rating: [rating, count]. */
    @Query("""
            select r.rating, count(r) from Review r
            where r.hotelId = :hotelId and r.status = com.flighthotel.hotel.entity.ReviewStatus.APPROVED
            group by r.rating""")
    List<Object[]> countApprovedByRating(@Param("hotelId") UUID hotelId);

    /** The creation time and rating of a hotel's approved reviews since a moment (the monthly figures). */
    @Query("""
            select r.createdAt, r.rating from Review r
            where r.hotelId = :hotelId and r.status = com.flighthotel.hotel.entity.ReviewStatus.APPROVED
              and r.createdAt >= :since""")
    List<Object[]> approvedSince(@Param("hotelId") UUID hotelId, @Param("since") java.time.Instant since);

    long countByHotelIdAndStatus(UUID hotelId, ReviewStatus status);

    /** Approved reviews of published hotels with at least {@code minRating} stars, newest first (home page). */
    @Query("""
            select r from Review r
            where r.status = com.flighthotel.hotel.entity.ReviewStatus.APPROVED and r.rating >= :minRating
              and r.hotelId in (select h.id from Hotel h where h.status = com.flighthotel.hotel.entity.HotelStatus.ACTIVE)
            order by r.createdAt desc, r.id desc""")
    List<Review> findFeatured(@Param("minRating") int minRating, Pageable pageable);

    /** Keyset pages over all reviews (the snapshot backfill). */
    @Query("select r.id from Review r order by r.id")
    List<UUID> findIdsOrderById(Pageable page);

    @Query("select r.id from Review r where r.id > :after order by r.id")
    List<UUID> findIdsAfter(@Param("after") UUID after, Pageable page);
}
