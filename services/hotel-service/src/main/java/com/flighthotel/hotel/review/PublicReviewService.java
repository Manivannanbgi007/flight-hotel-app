package com.flighthotel.hotel.review;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.hotel.dto.ReviewDtos.FeaturedReview;
import com.flighthotel.hotel.dto.ReviewDtos.HotelReviewsPage;
import com.flighthotel.hotel.dto.ReviewDtos.PublicReview;
import com.flighthotel.hotel.dto.ReviewDtos.ReviewSort;
import com.flighthotel.hotel.dto.ReviewDtos.ReviewSummary;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.Review;
import com.flighthotel.hotel.entity.ReviewStatus;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.ReviewRepository;
import com.flighthotel.hotel.search.HotelDetailsService;
import com.flighthotel.hotel.support.Paging;

/**
 * Reviews everyone can read (no login): a published hotel's approved reviews with their summary, and good recent
 * reviews for the home page. Pending and rejected reviews never appear here.
 */
@Service
public class PublicReviewService {

    static final int FEATURED_MIN_RATING = 4;
    static final int MAX_FEATURED = 20;

    private final ReviewRepository reviews;
    private final HotelRepository hotels;
    private final HotelDetailsService hotelDetails;

    public PublicReviewService(ReviewRepository reviews, HotelRepository hotels, HotelDetailsService hotelDetails) {
        this.reviews = reviews;
        this.hotels = hotels;
        this.hotelDetails = hotelDetails;
    }

    /** {@code 404 HOTEL_NOT_FOUND} for unknown or unpublished hotels, like the hotel page itself. */
    @Transactional(readOnly = true)
    public HotelReviewsPage hotelReviews(String idOrSlug, ReviewSort sort, int page, int size) {
        Hotel hotel = hotelDetails.findActive(idOrSlug);
        Sort order = switch (sort == null ? ReviewSort.RECENT : sort) {
            case RECENT -> Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
            case HIGHEST -> Sort.by(Sort.Order.desc("rating"), Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
            case LOWEST -> Sort.by(Sort.Order.asc("rating"), Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
        };
        Page<Review> result = reviews.findByHotelIdAndStatus(hotel.getId(), ReviewStatus.APPROVED,
                Paging.of(page, size, order));
        List<PublicReview> content = result.getContent().stream().map(ReviewViews::publicReview).toList();
        return new HotelReviewsPage(content, result.getNumber(), result.getSize(), result.getTotalElements(),
                result.getTotalPages(), summary(hotel.getId()));
    }

    /** Approved reviews with 4 or 5 stars of published hotels, newest first (home page). */
    @Transactional(readOnly = true)
    public List<FeaturedReview> featured(int limit) {
        List<Review> found = reviews.findFeatured(FEATURED_MIN_RATING,
                PageRequest.of(0, Math.min(Math.max(limit, 1), MAX_FEATURED)));
        Map<UUID, Hotel> hotelsById = hotels.findAllById(found.stream().map(Review::getHotelId)
                .collect(Collectors.toSet())).stream().collect(Collectors.toMap(Hotel::getId, Function.identity()));
        return found.stream().map(review -> {
            Hotel hotel = hotelsById.get(review.getHotelId());
            return new FeaturedReview(review.getId(), review.getRating(), review.getTitle(), review.getText(),
                    review.getAuthorName(), ReviewViews.stayedIn(review.getStayedOn()), review.getCreatedAt(),
                    hotel.getId(), hotel.getName(), hotel.getSlug(), hotel.getCity());
        }).toList();
    }

    private ReviewSummary summary(UUID hotelId) {
        Map<String, Long> distribution = new LinkedHashMap<>();
        for (int stars = 5; stars >= 1; stars--) {
            distribution.put(String.valueOf(stars), 0L);
        }
        long count = 0;
        long total = 0;
        for (Object[] row : reviews.countApprovedByRating(hotelId)) {
            int stars = ((Number) row[0]).intValue();
            long reviewsWithStars = ((Number) row[1]).longValue();
            distribution.put(String.valueOf(stars), reviewsWithStars);
            count += reviewsWithStars;
            total += stars * reviewsWithStars;
        }
        BigDecimal average = count == 0 ? null
                : BigDecimal.valueOf(total).divide(BigDecimal.valueOf(count), 1, RoundingMode.HALF_UP);
        return new ReviewSummary(average, count, distribution);
    }
}
