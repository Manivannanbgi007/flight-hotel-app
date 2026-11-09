package com.flighthotel.hotel.review;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.hotel.dto.ReviewDtos.ManagerReview;
import com.flighthotel.hotel.dto.ReviewDtos.ManagerReviewSummary;
import com.flighthotel.hotel.dto.ReviewDtos.ReviewMonth;
import com.flighthotel.hotel.entity.Review;
import com.flighthotel.hotel.entity.ReviewStatus;
import com.flighthotel.hotel.repository.ReviewRepository;
import com.flighthotel.hotel.staff.HotelAccess;
import com.flighthotel.hotel.support.Paging;

import jakarta.persistence.criteria.Predicate;

/**
 * A hotel's reviews for its managers (and admins), in every status, read only: moderation is the platform's job,
 * so a hotel can never hide a bad review. Reports and moderators' reasons stay with the moderators.
 */
@Service
@PreAuthorize("hasAnyAuthority('HOTEL_MANAGE_ANY', 'HOTEL_MANAGE_ASSIGNED')")
public class ManagerReviewService {

    private final ReviewRepository reviews;
    private final HotelAccess access;
    private final Clock clock;

    public ManagerReviewService(ReviewRepository reviews, HotelAccess access, Clock clock) {
        this.reviews = reviews;
        this.access = access;
        this.clock = clock;
    }

    /**
     * @param rating only reviews with this many stars (1 to 5), or null
     * @param sort   newest (default), oldest, highest or lowest rated first
     */
    @Transactional(readOnly = true)
    public PageResponse<ManagerReview> hotelReviews(UUID hotelId, ReviewStatus status, Integer rating, String sort,
            int page, int size) {
        access.requireManage(hotelId);
        if (rating != null && (rating < 1 || rating > 5)) {
            throw new BusinessRuleException("INVALID_RATING", "The rating filter is a number of stars from 1 to 5.");
        }
        Sort order = switch (sort == null ? "newest" : sort) {
            case "newest" -> Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
            case "oldest" -> Sort.by(Sort.Order.asc("createdAt"), Sort.Order.asc("id"));
            case "highest" -> Sort.by(Sort.Order.desc("rating"), Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
            case "lowest" -> Sort.by(Sort.Order.asc("rating"), Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
            default -> throw new BusinessRuleException("INVALID_SORT", "sort must be newest, oldest, highest or lowest.");
        };
        var request = Paging.of(page, size, order);
        Specification<Review> filter = (root, query, cb) -> {
            List<Predicate> where = new ArrayList<>();
            where.add(cb.equal(root.get("hotelId"), hotelId));
            if (status != null) {
                where.add(cb.equal(root.get("status"), status));
            }
            if (rating != null) {
                where.add(cb.equal(root.get("rating"), rating));
            }
            return cb.and(where.toArray(Predicate[]::new));
        };
        Page<Review> result = reviews.findAll(filter, request);
        return PageResponse.from(result, ReviewViews::managerReview);
    }

    /** The figures above the reviews: average, counts per star, positive and negative, and the last 12 months. */
    @Transactional(readOnly = true)
    public ManagerReviewSummary summary(UUID hotelId) {
        access.requireManage(hotelId);
        Map<Integer, Long> distribution = new LinkedHashMap<>();
        for (int stars = 1; stars <= 5; stars++) {
            distribution.put(stars, 0L);
        }
        for (Object[] row : reviews.countApprovedByRating(hotelId)) {
            distribution.put(((Number) row[0]).intValue(), ((Number) row[1]).longValue());
        }
        long total = distribution.values().stream().mapToLong(Long::longValue).sum();
        long weighted = distribution.entrySet().stream().mapToLong(e -> e.getKey() * e.getValue()).sum();
        long positive = distribution.get(4) + distribution.get(5);
        long negative = distribution.get(1) + distribution.get(2);

        YearMonth current = YearMonth.now(clock.withZone(ZoneOffset.UTC));
        Map<YearMonth, long[]> byMonth = new LinkedHashMap<>();   // reviews, rating sum, positive, negative
        for (int back = 11; back >= 0; back--) {
            byMonth.put(current.minusMonths(back), new long[4]);
        }
        Instant since = current.minusMonths(11).atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        for (Object[] row : reviews.approvedSince(hotelId, since)) {
            long[] month = byMonth.get(YearMonth.from(((Instant) row[0]).atZone(ZoneOffset.UTC)));
            int stars = ((Number) row[1]).intValue();
            if (month != null) {
                month[0]++;
                month[1] += stars;
                month[2] += stars >= 4 ? 1 : 0;
                month[3] += stars <= 2 ? 1 : 0;
            }
        }
        List<ReviewMonth> months = byMonth.entrySet().stream().map(e -> new ReviewMonth(e.getKey().toString(),
                e.getValue()[0], e.getValue()[0] == 0 ? null : BigDecimal.valueOf(e.getValue()[1])
                        .divide(BigDecimal.valueOf(e.getValue()[0]), 1, RoundingMode.HALF_UP),
                e.getValue()[2], e.getValue()[3])).toList();
        return new ManagerReviewSummary(total == 0 ? null : BigDecimal.valueOf(weighted)
                .divide(BigDecimal.valueOf(total), 1, RoundingMode.HALF_UP), total, distribution.get(5), positive,
                negative, reviews.countByHotelIdAndStatus(hotelId, ReviewStatus.PENDING), distribution, months);
    }
}
