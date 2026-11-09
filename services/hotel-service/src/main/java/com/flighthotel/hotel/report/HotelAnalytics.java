package com.flighthotel.hotel.report;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.flighthotel.common.analytics.Change;
import com.flighthotel.common.analytics.DayRange;
import com.flighthotel.common.analytics.Interval;
import com.flighthotel.common.analytics.Interval.Bucket;
import com.flighthotel.common.analytics.Timeline;
import com.flighthotel.hotel.dto.ReportDtos.CancellationFigures;
import com.flighthotel.hotel.dto.ReportDtos.HotelComparison;
import com.flighthotel.hotel.dto.ReportDtos.RatingFigures;
import com.flighthotel.hotel.dto.ReportDtos.TrendPoint;
import com.flighthotel.hotel.report.HotelFigures.ApprovedReview;
import com.flighthotel.hotel.report.HotelFigures.HotelRating;
import com.flighthotel.hotel.report.HotelFigures.NightRevenue;
import com.flighthotel.hotel.report.HotelFigures.Occupancy;
import com.flighthotel.hotel.review.HotelRatings;
import com.flighthotel.hotel.review.HotelRatings.Rating;

/**
 * The Phase 11 part of the hotel manager dashboard: the trend by interval, the comparison with the previous period of
 * the same length, cancellations by who cancelled and the rating over time. Every figure is a sum of nights (occupancy,
 * revenue, as in the reports of {@link HotelFigures}) or India days (bookings, cancellations, approved reviews), so the
 * range, the buckets and the previous period always agree.
 */
@Component
public class HotelAnalytics {

    private final HotelFigures figures;

    public HotelAnalytics(HotelFigures figures) {
        this.figures = figures;
    }

    /** Everything of one hotel for the range and the previous period, read once. */
    public Snapshot read(UUID hotelId, DayRange range) {
        DayRange previous = range.previous();
        return new Snapshot(range, previous,
                figures.occupancy(List.of(hotelId), previous.from(), range.to()).getOrDefault(hotelId, Map.of()),
                figures.revenue(List.of(hotelId), previous.from(), range.to()).getOrDefault(hotelId, Map.of()),
                figures.reservationsByDay(hotelId, previous.from(), range.to()),
                figures.cancellationsByDay(hotelId, previous.from(), range.to()),
                figures.approvedReviews(hotelId, range.to()), figures.rating(hotelId));
    }

    public record Snapshot(DayRange range, DayRange previous, Map<LocalDate, Occupancy> occupancy,
            Map<LocalDate, NightRevenue> revenue, Map<LocalDate, long[]> reservations,
            Map<LocalDate, long[]> cancellations, List<ApprovedReview> reviews, HotelRating rating) {

        /** The additive figures of [from, to]. */
        Totals totals(LocalDate from, LocalDate to) {
            Totals totals = new Totals();
            for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
                Occupancy night = occupancy.get(day);
                if (night != null) {
                    totals.available += night.roomNights();
                    totals.booked += night.booked();
                }
                NightRevenue sold = revenue.get(day);
                if (sold != null) {
                    totals.sold += sold.roomNights();
                    totals.revenue = totals.revenue.add(sold.amount());
                }
                long[] booked = reservations.get(day);
                if (booked != null) {
                    totals.reservations += booked[0];
                    totals.cancelledOfBooked += booked[1];
                }
                long[] cancelled = cancellations.get(day);
                if (cancelled != null) {
                    totals.cancellations += cancelled[0];
                    totals.cancelledByHotel += cancelled[1];
                }
            }
            for (ApprovedReview review : reviews) {
                if (!review.day().isBefore(from) && !review.day().isAfter(to)) {
                    totals.newReviews++;
                    totals.stars += review.rating();
                }
            }
            return totals;
        }

        /** The hotel's rating at the end of the India day: seed figures and the reviews approved until then. */
        Rating ratingAt(LocalDate day) {
            long count = 0;
            long stars = 0;
            for (ApprovedReview review : reviews) {
                if (!review.day().isAfter(day)) {
                    count++;
                    stars += review.rating();
                }
            }
            return HotelRatings.combine(rating.seedRating(), rating.seedReviews(), count, stars);
        }
    }

    static final class Totals {
        long available;
        long booked;
        long sold;
        BigDecimal revenue = BigDecimal.ZERO;
        long reservations;
        long cancelledOfBooked;
        long cancellations;
        long cancelledByHotel;
        long newReviews;
        long stars;

        BigDecimal occupancyPercent() {
            return HotelFigures.percent(booked, available);
        }

        BigDecimal averageDailyRate() {
            return HotelFigures.averageRate(revenue, sold);
        }

        /** Revenue per available room-night (two decimals; 0 without rooms for sale). */
        BigDecimal revPar() {
            return HotelFigures.averageRate(revenue, available);
        }

        BigDecimal averageRating() {
            return newReviews == 0 ? null
                    : BigDecimal.valueOf(stars).divide(BigDecimal.valueOf(newReviews), 1, RoundingMode.HALF_UP);
        }
    }

    public Totals totals(Snapshot snapshot) {
        return snapshot.totals(snapshot.range().from(), snapshot.range().to());
    }

    public CancellationFigures cancellations(Totals totals) {
        return new CancellationFigures(totals.cancellations, totals.cancellations - totals.cancelledByHotel,
                totals.cancelledByHotel, totals.cancelledOfBooked,
                HotelFigures.percent(totals.cancelledOfBooked, totals.reservations));
    }

    public RatingFigures ratings(Snapshot snapshot, Totals totals) {
        HotelRating rating = snapshot.rating();
        return new RatingFigures(rating.guestRating(), rating.reviewCount(), totals.newReviews, totals.averageRating(),
                rating.pendingReviews());
    }

    public HotelComparison comparison(Snapshot snapshot, Totals now) {
        Totals before = snapshot.totals(snapshot.previous().from(), snapshot.previous().to());
        return new HotelComparison(Change.of(HotelFigures.money(now.revenue), HotelFigures.money(before.revenue)),
                Change.of(now.occupancyPercent(), before.occupancyPercent()),
                Change.of(now.averageDailyRate(), before.averageDailyRate()),
                Change.of(now.revPar(), before.revPar()),
                Change.of(now.sold, before.sold),
                Change.of(now.reservations, before.reservations),
                Change.of(now.cancellations, before.cancellations),
                Change.of(now.newReviews, before.newReviews));
    }

    public List<TrendPoint> trend(Snapshot snapshot, Interval interval) {
        List<TrendPoint> points = new ArrayList<>();
        for (Bucket bucket : Timeline.of(snapshot.range(), interval).buckets()) {
            Totals t = snapshot.totals(bucket.start(), bucket.end());
            Rating rating = snapshot.ratingAt(bucket.end());
            points.add(new TrendPoint(bucket.key(), bucket.start(), bucket.end(), t.available, t.booked,
                    t.occupancyPercent(), t.sold, HotelFigures.money(t.revenue), t.averageDailyRate(), t.revPar(),
                    t.reservations, t.cancellations, t.newReviews, t.averageRating(), rating.average(),
                    rating.reviews()));
        }
        return points;
    }
}
