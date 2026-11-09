package com.flighthotel.hotel.report;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.hotel.dto.ReportDtos.DateRange;
import com.flighthotel.hotel.dto.ReportDtos.HotelOccupancy;
import com.flighthotel.hotel.dto.ReportDtos.OccupancyOverview;
import com.flighthotel.hotel.dto.ReportDtos.OccupancyOverviewTotals;
import com.flighthotel.hotel.dto.ReportDtos.OccupancyTotals;
import com.flighthotel.hotel.dto.ReportDtos.RevenueTotals;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.report.HotelFigures.NightRevenue;
import com.flighthotel.hotel.report.HotelFigures.Occupancy;

/**
 * Occupancy and revenue of every hotel side by side for admins (API_DOCUMENTATION.md §14.5, "hotel occupancy lives
 * where the rooms are"). Same figures as the managers' reports ({@link HotelFigures}); draft hotels, which never
 * sold anything, are left out.
 */
@Service
@PreAuthorize("hasRole('ADMIN')")
public class AdminOccupancyService {

    private final HotelRepository hotels;
    private final HotelFigures figures;
    private final Clock clock;

    public AdminOccupancyService(HotelRepository hotels, HotelFigures figures, Clock clock) {
        this.hotels = hotels;
        this.figures = figures;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public OccupancyOverview overview(String preset, LocalDate from, LocalDate to) {
        DateRange range = ReportRanges.resolve(preset, from, to, LocalDate.now(clock.withZone(ReportRanges.INDIA)));
        List<Hotel> list = new ArrayList<>(hotels.findByStatus(HotelStatus.ACTIVE));
        list.addAll(hotels.findByStatus(HotelStatus.INACTIVE));
        list.sort(Comparator.comparing(Hotel::getName, String.CASE_INSENSITIVE_ORDER));
        List<UUID> ids = list.stream().map(Hotel::getId).toList();
        Map<UUID, Map<LocalDate, Occupancy>> occupancy = figures.occupancy(ids, range.from(), range.to());
        Map<UUID, Map<LocalDate, NightRevenue>> revenue = figures.revenue(ids, range.from(), range.to());

        List<HotelOccupancy> rows = new ArrayList<>();
        long roomNights = 0;
        long booked = 0;
        BigDecimal totalRevenue = BigDecimal.ZERO;
        for (Hotel hotel : list) {
            OccupancyTotals hotelOccupancy = HotelFigures.occupancyTotals(HotelFigures.occupancyRows(
                    occupancy.getOrDefault(hotel.getId(), Map.of()), range.from(), range.to()));
            RevenueTotals hotelRevenue = HotelFigures.revenueTotals(HotelFigures.revenueRows(
                    revenue.getOrDefault(hotel.getId(), Map.of()), range.from(), range.to()));
            rows.add(new HotelOccupancy(hotel.getId(), hotel.getName(), hotel.getCity(), hotelOccupancy.roomNights(),
                    hotelOccupancy.bookedRoomNights(), hotelOccupancy.occupancyPercent(), hotelRevenue.revenue()));
            roomNights += hotelOccupancy.roomNights();
            booked += hotelOccupancy.bookedRoomNights();
            totalRevenue = totalRevenue.add(hotelRevenue.revenue());
        }
        return new OccupancyOverview(range, rows, new OccupancyOverviewTotals(roomNights, booked,
                HotelFigures.percent(booked, roomNights), HotelFigures.money(totalRevenue)));
    }

    @Transactional(readOnly = true)
    public CsvFile overviewCsv(String preset, LocalDate from, LocalDate to) {
        OccupancyOverview overview = overview(preset, from, to);
        List<List<Object>> rows = new ArrayList<>();
        overview.hotels().forEach(row -> rows.add(List.of(row.name(), row.city(), row.roomNights(),
                row.bookedRoomNights(), row.occupancyPercent(), row.revenue())));
        OccupancyOverviewTotals totals = overview.totals();
        rows.add(List.of("Total", "", totals.roomNights(), totals.bookedRoomNights(), totals.occupancyPercent(),
                totals.revenue()));
        return CsvFile.of("hotel-occupancy-" + overview.range().from() + "-" + overview.range().to() + ".csv",
                List.of("Hotel", "City", "Room nights", "Booked room nights", "Occupancy %",
                        "Revenue (INR, without GST)"), rows);
    }
}
