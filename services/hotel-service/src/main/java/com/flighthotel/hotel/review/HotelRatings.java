package com.flighthotel.hotel.review;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Types;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.SqlParameterValue;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.messaging.CatalogEvents;
import com.flighthotel.hotel.search.SearchRefresh;
import com.flighthotel.hotel.support.Uuids;

/**
 * Keeps a hotel's {@code guestRating} / {@code reviewCount} in line with its reviews:
 * <pre>
 *   reviewCount = seed_review_count + approved reviews
 *   guestRating = (seed_rating × seed_review_count + sum of approved ratings) / reviewCount   (1 decimal, half up)
 * </pre>
 * The seed figures are what the hotel started with (the labelled demo data, e.g. 4.4 from 312 reviews; none for
 * real hotels), so a few new reviews move a demo hotel's rating only a little, as they would on a real site. Without
 * any figure the rating is empty (null), never 0.
 * <p>
 * Always recalculated from scratch, never adjusted by +1/-1, so it cannot drift. The hotel row is locked first, so
 * two moderators deciding on reviews of the same hotel at the same moment are handled one after the other; the
 * caller's transaction must be READ COMMITTED, so the second one counts the first one's committed decision.
 */
@Component
public class HotelRatings {

    private static final Logger log = LoggerFactory.getLogger(HotelRatings.class);

    private final JdbcClient jdbc;
    private final CatalogEvents catalogEvents;
    private final SearchRefresh searchRefresh;

    public HotelRatings(JdbcClient jdbc, CatalogEvents catalogEvents, SearchRefresh searchRefresh) {
        this.jdbc = jdbc;
        this.catalogEvents = catalogEvents;
        this.searchRefresh = searchRefresh;
    }

    /** Recalculates and stores the rating, then updates the search index (now and through the outbox). */
    @Transactional(propagation = Propagation.MANDATORY)
    public Rating recalculate(UUID hotelId) {
        HotelSeed seed = jdbc.sql("SELECT seed_rating, seed_review_count, status FROM hotels WHERE id = :id FOR UPDATE")
                .param("id", Uuids.param(hotelId))
                .query((rs, i) -> new HotelSeed(rs.getBigDecimal("seed_rating"), rs.getInt("seed_review_count"),
                        HotelStatus.valueOf(rs.getString("status"))))
                .optional()
                .orElseThrow(() -> new ResourceNotFoundException("Hotel", hotelId));
        long[] approved = jdbc.sql("""
                        SELECT COUNT(*) AS reviews, COALESCE(SUM(rating), 0) AS stars FROM reviews
                        WHERE hotel_id = :id AND status = 'APPROVED'""")
                .param("id", Uuids.param(hotelId))
                .query((rs, i) -> new long[] {rs.getLong("reviews"), rs.getLong("stars")})
                .single();
        Rating rating = combine(seed.rating(), seed.reviews(), approved[0], approved[1]);
        jdbc.sql("UPDATE hotels SET avg_rating = :rating, review_count = :reviews WHERE id = :id")
                .param("rating", new SqlParameterValue(Types.DECIMAL, rating.average()))
                .param("reviews", rating.reviews())
                .param("id", Uuids.param(hotelId))
                .update();
        // Customers see the rating on search cards: rebuild the search document (outbox = reliable, refresh = now).
        catalogEvents.catalogChanged(hotelId, seed.status());
        searchRefresh.afterCommit(hotelId);
        log.info("Hotel rating recalculated hotelId={} rating={} reviews={} approvedHere={}", hotelId,
                rating.average(), rating.reviews(), approved[0]);
        return rating;
    }

    /** The formula above. Seed figures only count when there is a seed rating. */
    public static Rating combine(BigDecimal seedRating, int seedReviews, long approvedReviews, long approvedStars) {
        int seeds = seedRating == null ? 0 : Math.max(seedReviews, 0);
        long reviews = seeds + approvedReviews;
        if (reviews == 0) {
            return new Rating(null, 0);
        }
        BigDecimal stars = (seeds == 0 ? BigDecimal.ZERO : seedRating.multiply(BigDecimal.valueOf(seeds)))
                .add(BigDecimal.valueOf(approvedStars));
        return new Rating(stars.divide(BigDecimal.valueOf(reviews), 1, RoundingMode.HALF_UP), (int) reviews);
    }

    /** @param average 1.0–5.0, null without any review */
    public record Rating(BigDecimal average, int reviews) {
    }

    private record HotelSeed(BigDecimal rating, int reviews, HotelStatus status) {
    }
}
