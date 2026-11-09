package com.flighthotel.hotel.report;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.analytics.DayRange;
import com.flighthotel.common.analytics.Interval;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.hotel.dto.FrontDeskDtos.DateField;
import com.flighthotel.hotel.dto.FrontDeskDtos.ReservationRow;
import com.flighthotel.hotel.dto.ReportDtos.DashboardStats;
import com.flighthotel.hotel.dto.ReportDtos.DateRange;
import com.flighthotel.hotel.dto.ReportDtos.HotelDashboard;
import com.flighthotel.hotel.dto.ReportDtos.OccupancyNight;
import com.flighthotel.hotel.dto.ReportDtos.OccupancyReport;
import com.flighthotel.hotel.dto.ReportDtos.OccupancyTotals;
import com.flighthotel.hotel.dto.ReportDtos.RevenueNight;
import com.flighthotel.hotel.dto.ReportDtos.RevenueReport;
import com.flighthotel.hotel.dto.ReportDtos.RevenueTotals;
import com.flighthotel.hotel.dto.ReportDtos.RoomTypeReport;
import com.flighthotel.hotel.dto.ReportDtos.RoomTypeRow;
import com.flighthotel.hotel.dto.ReportDtos.TodayFigures;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.frontdesk.ReservationQueries;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.staff.HotelAccess;

/**
 * The hotel manager's dashboard and reports (API_DOCUMENTATION.md §14.5); figures as defined in {@link HotelFigures}.
 * Ranges are India days (§14.0); "today" at the front desk is the hotel's own day (its time zone).
 */
@Service
@PreAuthorize("hasAnyAuthority('HOTEL_MANAGE_ANY', 'HOTEL_MANAGE_ASSIGNED')")
public class HotelReportService {

    static final int UPCOMING_DAYS = 7;
    static final int MAX_UPCOMING = 100;

    private final HotelAccess access;
    private final HotelRepository hotels;
    private final HotelFigures figures;
    private final ReservationQueries reservations;
    private final HotelAnalytics analytics;
    private final Clock clock;

    public HotelReportService(HotelAccess access, HotelRepository hotels, HotelFigures figures,
            ReservationQueries reservations, HotelAnalytics analytics, Clock clock) {
        this.access = access;
        this.hotels = hotels;
        this.figures = figures;
        this.reservations = reservations;
        this.analytics = analytics;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public OccupancyReport occupancy(UUID hotelId, String preset, LocalDate from, LocalDate to) {
        access.requireManage(hotelId);
        Hotel hotel = hotel(hotelId);
        DateRange range = range(preset, from, to);
        List<OccupancyNight> rows = HotelFigures.occupancyRows(figures.occupancy(List.of(hotelId), range.from(),
                range.to()).getOrDefault(hotelId, Map.of()), range.from(), range.to());
        return new OccupancyReport(range, hotelId, hotel.getName(), rows, HotelFigures.occupancyTotals(rows));
    }

    /** Room type performance: sold room-nights, revenue and average daily rate per type on the nights of the range. */
    @Transactional(readOnly = true)
    public RoomTypeReport roomTypes(UUID hotelId, String preset, LocalDate from, LocalDate to) {
        access.requireManage(hotelId);
        Hotel hotel = hotel(hotelId);
        DateRange range = range(preset, from, to);
        List<RoomTypeRow> rows = figures.roomTypePerformance(hotelId, range.from(), range.to());
        return new RoomTypeReport(range, hotelId, hotel.getName(), "INR", rows,
                rows.stream().mapToLong(RoomTypeRow::roomNights).sum(),
                rows.stream().map(RoomTypeRow::revenue).reduce(java.math.BigDecimal.ZERO, java.math.BigDecimal::add));
    }

    @Transactional(readOnly = true)
    public RevenueReport revenue(UUID hotelId, String preset, LocalDate from, LocalDate to) {
        access.requireManage(hotelId);
        Hotel hotel = hotel(hotelId);
        DateRange range = range(preset, from, to);
        List<RevenueNight> rows = HotelFigures.revenueRows(figures.revenue(List.of(hotelId), range.from(), range.to())
                .getOrDefault(hotelId, Map.of()), range.from(), range.to());
        return new RevenueReport(range, hotelId, hotel.getName(), "INR", rows, HotelFigures.revenueTotals(rows));
    }

    @Transactional(readOnly = true)
    public CsvFile occupancyCsv(UUID hotelId, String preset, LocalDate from, LocalDate to) {
        OccupancyReport report = occupancy(hotelId, preset, from, to);
        List<List<Object>> rows = new ArrayList<>();
        report.rows().forEach(row -> rows.add(List.of(row.date(), row.roomNights(), row.bookedRoomNights(),
                row.occupancyPercent())));
        OccupancyTotals totals = report.totals();
        rows.add(List.of("Total", totals.roomNights(), totals.bookedRoomNights(), totals.occupancyPercent()));
        return CsvFile.of(filename("occupancy", hotelId, report.range()),
                List.of("Date", "Room nights", "Booked room nights", "Occupancy %"), rows);
    }

    @Transactional(readOnly = true)
    public CsvFile revenueCsv(UUID hotelId, String preset, LocalDate from, LocalDate to) {
        RevenueReport report = revenue(hotelId, preset, from, to);
        List<List<Object>> rows = new ArrayList<>();
        report.rows().forEach(row -> rows.add(List.of(row.date(), row.roomNights(), row.revenue(),
                row.averageDailyRate())));
        RevenueTotals totals = report.totals();
        rows.add(List.of("Total", totals.roomNights(), totals.revenue(), totals.averageDailyRate()));
        return CsvFile.of(filename("revenue", hotelId, report.range()),
                List.of("Date", "Room nights sold", "Revenue (INR, without GST)", "Average daily rate (INR)"), rows);
    }

    /**
     * Today's front desk (arrivals, departures, in house, tonight's occupancy), the confirmed arrivals of the next
     * {@value #UPCOMING_DAYS} days (today included, at most {@value #MAX_UPCOMING}), and the range's figures:
     * reservations booked and cancellations made in the range, and revenue, sold room-nights, occupancy and average
     * daily rate for the nights of the range.
     */
    /**
     * Phase 11 adds, for ranges of up to five years: RevPAR and the room-nights behind the occupancy, the people at
     * the front desk today, cancellations by who cancelled and the cancellation rate, the rating and new reviews, the
     * comparison with the previous period of the same length, and the trend by {@code interval} (DAY, WEEK, MONTH or
     * YEAR; by default from the length of the range).
     */
    @Transactional(readOnly = true)
    public HotelDashboard dashboard(UUID hotelId, String preset, LocalDate from, LocalDate to, String interval) {
        access.requireManage(hotelId);
        Hotel hotel = hotel(hotelId);
        DateRange range = ReportRanges.resolve(preset, from, to, LocalDate.now(clock.withZone(ReportRanges.INDIA)),
                DayRange.FIVE_YEARS);
        DayRange days = ReportRanges.toDayRange(range);
        Interval step = Interval.resolve(interval, days);
        ZoneId hotelZone = ZoneId.of(hotel.getTimeZone());
        LocalDate today = LocalDate.now(clock.withZone(hotelZone));

        long[] desk = figures.frontDeskToday(hotelId, today);
        List<OccupancyNight> tonight = HotelFigures.occupancyRows(figures.occupancy(List.of(hotelId), today, today)
                .getOrDefault(hotelId, Map.of()), today, today);
        TodayFigures todayFigures = new TodayFigures(today, desk[0], desk[1], desk[2],
                tonight.getFirst().occupancyPercent(), desk[3], desk[4], desk[5], desk[6], figures.totalRooms(hotelId),
                tonight.getFirst().roomNights(), tonight.getFirst().bookedRoomNights());

        List<ReservationRow> upcoming = reservations.find(hotelId, List.of(ReservationStatus.CONFIRMED), today,
                today.plusDays(UPCOMING_DAYS - 1L), DateField.CHECK_IN, null, hotelZone,
                PageRequest.of(0, MAX_UPCOMING, Sort.by(Sort.Order.asc("checkIn")))).getContent();

        // The range's figures are the sums of its nights and days, as in the reports.
        HotelAnalytics.Snapshot snapshot = analytics.read(hotelId, days);
        HotelAnalytics.Totals totals = analytics.totals(snapshot);
        DashboardStats stats = new DashboardStats(totals.reservations, totals.sold, HotelFigures.money(totals.revenue),
                totals.cancellations, totals.occupancyPercent(), totals.averageDailyRate(), totals.available,
                totals.booked, totals.revPar());
        DayRange previous = snapshot.previous();
        return new HotelDashboard(range, hotelId, hotel.getName(), todayFigures, upcoming, stats, step,
                new DateRange(previous.preset(), previous.from(), previous.to()), analytics.cancellations(totals),
                analytics.ratings(snapshot, totals), analytics.comparison(snapshot, totals),
                analytics.trend(snapshot, step));
    }

    private DateRange range(String preset, LocalDate from, LocalDate to) {
        return ReportRanges.resolve(preset, from, to, LocalDate.now(clock.withZone(ReportRanges.INDIA)));
    }

    private Hotel hotel(UUID hotelId) {
        return hotels.findById(hotelId).orElseThrow(() -> new ResourceNotFoundException("Hotel", hotelId));
    }

    /** e.g. {@code occupancy-sea-breeze-resort-goa-2026-10-07-2026-11-05.csv} */
    private String filename(String report, UUID hotelId, DateRange range) {
        return report + "-" + hotel(hotelId).getSlug() + "-" + range.from() + "-" + range.to() + ".csv";
    }
}
