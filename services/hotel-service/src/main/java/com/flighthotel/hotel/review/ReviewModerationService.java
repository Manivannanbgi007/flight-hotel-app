package com.flighthotel.hotel.review;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.hotel.dto.ReviewDtos.AdminReview;
import com.flighthotel.hotel.dto.ReviewDtos.ReviewReportItem;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.Review;
import com.flighthotel.hotel.entity.ReviewReport;
import com.flighthotel.hotel.entity.ReviewStatus;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.ReviewReportRepository;
import com.flighthotel.hotel.repository.ReviewRepository;
import com.flighthotel.hotel.support.Paging;

import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;

/**
 * Review moderation (permission {@code REVIEW_MODERATE}): the queue, approve, reject.
 * <ul>
 *   <li>Approve: PENDING or REJECTED → APPROVED. Approving an APPROVED review is how a moderator keeps a reported
 *       review: its open reports are closed and nothing else changes.</li>
 *   <li>Reject (with a reason the author sees): PENDING or APPROVED → REJECTED. Rejecting an approved review takes it
 *       off the hotel page.</li>
 *   <li>Every decision closes the review's open reports, is audited (ids, ratings and counts only: no review text,
 *       no reason), refreshes the screens ({@code review.changed}) and publishes the review's snapshot
 *       ({@link ReviewSnapshots}).</li>
 *   <li>When the set of approved reviews changes, the hotel's rating is recalculated and its search document rebuilt
 *       ({@link HotelRatings}). READ COMMITTED: see there.</li>
 * </ul>
 */
@Service
@PreAuthorize("hasAuthority('REVIEW_MODERATE')")
public class ReviewModerationService {

    private static final Logger log = LoggerFactory.getLogger(ReviewModerationService.class);
    private static final Set<String> SORTABLE = Set.of("createdAt", "rating", "moderatedAt");

    private final ReviewRepository reviews;
    private final ReviewReportRepository reports;
    private final HotelRepository hotels;
    private final HotelRatings ratings;
    private final ReviewEvents events;
    private final ReviewSnapshots snapshots;
    private final AuditPublisher audit;
    private final Clock clock;

    public ReviewModerationService(ReviewRepository reviews, ReviewReportRepository reports, HotelRepository hotels,
            HotelRatings ratings, ReviewEvents events, ReviewSnapshots snapshots, AuditPublisher audit, Clock clock) {
        this.reviews = reviews;
        this.reports = reports;
        this.hotels = hotels;
        this.ratings = ratings;
        this.events = events;
        this.snapshots = snapshots;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * @param reported true: only reviews with reports nobody dealt with yet; false: only reviews without
     * @param q        booking reference, hotel name, author name or title (contains, any case)
     */
    @Transactional(readOnly = true)
    public PageResponse<AdminReview> list(ReviewStatus status, Boolean reported, String q, Pageable pageable) {
        Specification<Review> filter = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            if (reported != null) {
                Subquery<UUID> open = query.subquery(UUID.class);
                Root<ReviewReport> report = open.from(ReviewReport.class);
                open.select(report.get("reviewId")).where(cb.equal(report.get("status"), ReviewReport.OPEN));
                predicates.add(reported ? root.get("id").in(open) : cb.not(root.get("id").in(open)));
            }
            if (q != null && !q.isBlank()) {
                String pattern = "%" + q.strip().toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%")
                        .replace("_", "\\_") + "%";
                Subquery<UUID> hotelIds = query.subquery(UUID.class);
                Root<Hotel> hotel = hotelIds.from(Hotel.class);
                hotelIds.select(hotel.get("id")).where(cb.like(cb.lower(hotel.get("name")), pattern, '\\'));
                predicates.add(cb.or(
                        cb.like(cb.lower(root.get("bookingReference")), pattern, '\\'),
                        cb.like(cb.lower(root.get("authorName")), pattern, '\\'),
                        cb.like(cb.lower(root.get("title")), pattern, '\\'),
                        root.get("hotelId").in(hotelIds)));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        Page<Review> page = reviews.findAll(filter, Paging.of(pageable, SORTABLE, Sort.by(Sort.Order.desc("createdAt"))));
        return PageResponse.from(page.map(view(page.getContent())));
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public AdminReview approve(UUID reviewId) {
        Review review = load(reviewId);
        ReviewStatus before = review.getStatus();
        Instant now = clock.instant();
        review.approve(moderator(), now);
        return decided(review, before, "REVIEW_APPROVED", now);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public AdminReview reject(UUID reviewId, String reason) {
        Review review = load(reviewId);
        ReviewStatus before = review.getStatus();
        if (before == ReviewStatus.REJECTED) {
            throw new ConflictException("INVALID_REVIEW_STATE", "This review has already been rejected.");
        }
        Instant now = clock.instant();
        review.reject(reason.strip(), moderator(), now);
        return decided(review, before, "REVIEW_REJECTED", now);
    }

    private AdminReview decided(Review review, ReviewStatus before, String action, Instant now) {
        // Flushed now: a moderator who saved meanwhile → 409 CONCURRENT_MODIFICATION; and the rating below counts it.
        reviews.saveAndFlush(review);
        int closedReports = reports.closeOpenReports(review.getId(), now);
        boolean ratingChanged = before != review.getStatus()
                && (before == ReviewStatus.APPROVED || review.isApproved());
        if (ratingChanged) {
            ratings.recalculate(review.getHotelId());
        }
        audit.record(action, "REVIEW", review.getId().toString(), Map.of(
                "hotelId", review.getHotelId().toString(),
                "bookingReference", review.getBookingReference(),
                "rating", String.valueOf(review.getRating()),
                "previousStatus", before.name(),
                "reportsClosed", String.valueOf(closedReports)));
        snapshots.changed(review.getId());
        events.changed(review);
        log.info("Review moderated reviewId={} {} -> {} reportsClosed={} ratingRecalculated={}", review.getId(), before,
                review.getStatus(), closedReports, ratingChanged);
        return view(List.of(review)).apply(review);
    }

    /** Maps a page of reviews with their hotels and open reports (two queries for the whole page). */
    private Function<Review, AdminReview> view(List<Review> page) {
        Map<UUID, Hotel> hotelsById = hotels.findAllById(page.stream().map(Review::getHotelId)
                .collect(Collectors.toSet())).stream().collect(Collectors.toMap(Hotel::getId, Function.identity()));
        Map<UUID, List<ReviewReport>> openReports = page.isEmpty() ? Map.of()
                : reports.findByReviewIdInAndStatusOrderByCreatedAtAsc(page.stream().map(Review::getId).toList(),
                        ReviewReport.OPEN).stream().collect(Collectors.groupingBy(ReviewReport::getReviewId));
        return review -> {
            Hotel hotel = hotelsById.get(review.getHotelId());
            List<ReviewReportItem> open = openReports.getOrDefault(review.getId(), List.of()).stream()
                    .map(report -> new ReviewReportItem(report.getReason(), report.getCreatedAt())).toList();
            return new AdminReview(review.getId(), review.getHotelId(), hotel == null ? null : hotel.getName(),
                    review.getBookingReference(), review.getAuthorName(), review.getRating(), review.getTitle(),
                    review.getText(), ReviewViews.stayedIn(review.getStayedOn()), review.getStatus(), open.size(),
                    open, review.getCreatedAt(), review.getModeratedAt(), review.getRejectionReason());
        };
    }

    private Review load(UUID reviewId) {
        return reviews.findById(reviewId).orElseThrow(() -> new ResourceNotFoundException("Review", reviewId));
    }

    private static String moderator() {
        return CurrentUser.require().id().toString();
    }
}
