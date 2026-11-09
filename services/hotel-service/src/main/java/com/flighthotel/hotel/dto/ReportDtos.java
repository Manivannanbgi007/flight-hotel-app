package com.flighthotel.hotel.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.flighthotel.common.analytics.Change;
import com.flighthotel.common.analytics.Interval;
import com.flighthotel.hotel.dto.FrontDeskDtos.ReservationRow;

/**
 * Hotel dashboard and reports (API_DOCUMENTATION.md §14.0, §14.5). Percentages have one decimal, money two.
 * Definitions: see {@code com.flighthotel.hotel.report.HotelFigures}.
 */
public final class ReportDtos {

    private ReportDtos() {
    }

    /** The resolved date range, echoed by every answer. Both days inclusive. */
    public record DateRange(String preset, LocalDate from, LocalDate to) {
    }

    // ------------------------------------------------------------------ occupancy

    /**
     * @param roomNights       rooms available that night
     * @param bookedRoomNights rooms sold that night
     */
    public record OccupancyNight(LocalDate date, long roomNights, long bookedRoomNights, BigDecimal occupancyPercent) {
    }

    public record OccupancyTotals(long roomNights, long bookedRoomNights, BigDecimal occupancyPercent) {
    }

    public record OccupancyReport(DateRange range, UUID hotelId, String hotelName, List<OccupancyNight> rows,
                                  OccupancyTotals totals) {
    }

    // ------------------------------------------------------------------ revenue

    /**
     * @param roomNights       rooms sold that night (by the stays that count as revenue)
     * @param revenue          room charges without GST, each stay's spread evenly over its nights
     * @param averageDailyRate revenue / roomNights (0 without rooms sold)
     */
    public record RevenueNight(LocalDate date, long roomNights, BigDecimal revenue, BigDecimal averageDailyRate) {
    }

    public record RevenueTotals(long roomNights, BigDecimal revenue, BigDecimal averageDailyRate) {
    }

    public record RevenueReport(DateRange range, UUID hotelId, String hotelName, String currency,
                                List<RevenueNight> rows, RevenueTotals totals) {
    }

    // ------------------------------------------------------------------ dashboard

    /**
     * Today at the hotel (its own time zone).
     *
     * @param arrivals         stays starting today that are confirmed or already checked in
     * @param departures       stays ending today that are checked in or already checked out
     * @param inHouse          guests checked in right now (all reservations CHECKED_IN)
     * @param occupancyPercent tonight's occupancy
     * @param arrivingGuests   Phase 11: people (adults + children) of the arrivals
     * @param departingGuests  Phase 11: people of the departures
     * @param inHouseGuests    Phase 11: people checked in right now
     * @param inHouseRooms     Phase 11: rooms of the reservations checked in right now
     */
    public record TodayFigures(LocalDate date, long arrivals, long departures, long inHouse,
                               BigDecimal occupancyPercent, long arrivingGuests, long departingGuests,
                               long inHouseGuests, long inHouseRooms, long totalRooms, long roomsForSale,
                               long roomsBooked) {
    }

    // ------------------------------------------------------------------ room types (Phase 12)

    /**
     * One room type for the range: reservations that overlap it, the room-nights sold and the room revenue (without GST)
     * on the nights of the range, the average daily rate, and this type's share of the hotel's revenue (%).
     */
    public record RoomTypeRow(UUID roomTypeId, String name, long stays, long roomNights, BigDecimal revenue,
                              BigDecimal averageDailyRate, BigDecimal revenueShare) {
    }

    public record RoomTypeReport(DateRange range, UUID hotelId, String hotelName, String currency,
                                 List<RoomTypeRow> rows, long roomNights, BigDecimal revenue) {
    }

    /**
     * For the range.
     *
     * @param reservations  reservations booked (created) in the range that were paid
     * @param cancellations reservations cancelled in the range (by the customer or the hotel)
     * @param roomNights    rooms sold on the nights of the range (as in the revenue report)
     * @param availableRoomNights Phase 11: rooms for sale on the nights of the range (as in the occupancy report)
     * @param bookedRoomNights    Phase 11: rooms booked on those nights (as in the occupancy report)
     * @param revPar              Phase 11: revenue per available room-night = revenue / availableRoomNights
     */
    public record DashboardStats(long reservations, long roomNights, BigDecimal revenue, long cancellations,
                                 BigDecimal occupancyPercent, BigDecimal averageDailyRate, long availableRoomNights,
                                 long bookedRoomNights, BigDecimal revPar) {
    }

    /**
     * Phase 11: cancellations made in the range, by who cancelled, and the cancellation rate of the range's bookings.
     *
     * @param count      reservations cancelled in the range (= {@code stats.cancellations})
     * @param ofBooked   of the paid reservations booked in the range ({@code stats.reservations}), those cancelled since
     * @param rate       ofBooked / stats.reservations × 100 (one decimal)
     */
    public record CancellationFigures(long count, long byCustomer, long byHotel, long ofBooked, BigDecimal rate) {
    }

    /**
     * Phase 11: guest reviews. {@code guestRating} / {@code reviewCount}: the hotel's rating now (seed figures and
     * approved reviews); {@code newReviews}: reviews approved in the range, {@code averageNewRating} their average
     * (null without any); {@code pendingReviews}: waiting for moderation now.
     */
    public record RatingFigures(BigDecimal guestRating, long reviewCount, long newReviews, BigDecimal averageNewRating,
                                long pendingReviews) {
    }

    /**
     * Phase 11: one point of the trend (the nights / days of the bucket). Occupancy, revenue, ADR and RevPAR as for
     * the range; {@code reservations} booked and {@code cancellations} made on those days; {@code newReviews}
     * approved on those days and {@code averageRating} their average (null without any); {@code guestRating} and
     * {@code reviewCount}: the hotel's rating at the end of the bucket.
     */
    public record TrendPoint(String key, LocalDate start, LocalDate end, long availableRoomNights,
                             long bookedRoomNights, BigDecimal occupancyPercent, long soldRoomNights,
                             BigDecimal revenue, BigDecimal averageDailyRate, BigDecimal revPar, long reservations,
                             long cancellations, long newReviews, BigDecimal averageRating, BigDecimal guestRating,
                             long reviewCount) {
    }

    /** Phase 11: the range against the previous period of the same length (occupancy: percentage points). */
    public record HotelComparison(Change revenue, Change occupancyPercent, Change averageDailyRate, Change revPar,
                                  Change soldRoomNights, Change reservations, Change cancellations,
                                  Change newReviews) {
    }

    /** {@code interval} … {@code trend}: Phase 11. */
    public record HotelDashboard(DateRange range, UUID hotelId, String hotelName, TodayFigures today,
                                 List<ReservationRow> upcomingArrivals, DashboardStats stats, Interval interval,
                                 DateRange previousRange, CancellationFigures cancellations, RatingFigures ratings,
                                 HotelComparison comparison, List<TrendPoint> trend) {
    }

    // ------------------------------------------------------------------ admin, all hotels

    public record HotelOccupancy(UUID hotelId, String name, String city, long roomNights, long bookedRoomNights,
                                 BigDecimal occupancyPercent, BigDecimal revenue) {
    }

    public record OccupancyOverviewTotals(long roomNights, long bookedRoomNights, BigDecimal occupancyPercent,
                                          BigDecimal revenue) {
    }

    /** One row per published (or unpublished, not draft) hotel, by name. */
    public record OccupancyOverview(DateRange range, List<HotelOccupancy> hotels, OccupancyOverviewTotals totals) {
    }
}
