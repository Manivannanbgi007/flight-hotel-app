package com.flighthotel.hotel.review;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;

import org.junit.jupiter.api.Test;

import com.flighthotel.hotel.review.HotelRatings.Rating;

/** The rating formula: seeded demo figures combined with approved reviews; display names of authors. */
class HotelRatingsTest {

    @Test
    void approvedReviewsAreAddedToTheSeedFigures() {
        // A demo hotel "4.4 from 312": one 5-star review moves it only a little.
        assertThat(HotelRatings.combine(new BigDecimal("4.4"), 312, 1, 5))
                .isEqualTo(new Rating(new BigDecimal("4.4"), 313));
        assertThat(HotelRatings.combine(new BigDecimal("4.0"), 2, 1, 5)).isEqualTo(new Rating(new BigDecimal("4.3"), 3));
        assertThat(HotelRatings.combine(new BigDecimal("4.0"), 2, 2, 6)).isEqualTo(new Rating(new BigDecimal("3.5"), 4));
    }

    @Test
    void aRealHotelIsRatedByItsReviewsOnlyAndUnratedWithoutAny() {
        assertThat(HotelRatings.combine(null, 0, 3, 11)).isEqualTo(new Rating(new BigDecimal("3.7"), 3));
        assertThat(HotelRatings.combine(null, 0, 0, 0)).isEqualTo(new Rating(null, 0));
        // A count without a rating means nothing.
        assertThat(HotelRatings.combine(null, 50, 1, 4)).isEqualTo(new Rating(new BigDecimal("4.0"), 1));
    }

    @Test
    void authorsAreShownByFirstNameAndInitial() {
        assertThat(ReviewViews.authorName("Asha", "Rao")).isEqualTo("Asha R.");
        assertThat(ReviewViews.authorName(" ravi ", "kumar")).isEqualTo("ravi K.");
        assertThat(ReviewViews.authorName("Asha", "")).isEqualTo("Asha");
        assertThat(ReviewViews.authorName(null, null)).isEqualTo("Guest");
        assertThat(ReviewViews.stayedIn(java.time.LocalDate.of(2026, 11, 3))).isEqualTo("Nov 2026");
    }
}
