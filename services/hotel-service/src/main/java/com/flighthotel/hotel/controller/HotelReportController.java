package com.flighthotel.hotel.controller;

import java.time.LocalDate;
import java.util.UUID;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.hotel.dto.ReportDtos.HotelDashboard;
import com.flighthotel.hotel.dto.ReportDtos.OccupancyReport;
import com.flighthotel.hotel.dto.ReportDtos.RevenueReport;
import com.flighthotel.hotel.dto.ReportDtos.RoomTypeReport;
import com.flighthotel.hotel.report.CsvFile;
import com.flighthotel.hotel.report.HotelReportService;
import com.flighthotel.hotel.report.ReportRanges;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * Hotel manager dashboard and reports (API_DOCUMENTATION.md §14.0, §14.5). {@code range=TODAY | LAST_7_DAYS |
 * LAST_14_DAYS | LAST_30_DAYS | THIS_MONTH | PREVIOUS_MONTH | CUSTOM} (default LAST_30_DAYS; CUSTOM needs from and
 * to).
 */
@RestController
@RequestMapping("/api/hotel-manager/hotels/{hotelId}")
@Tag(name = "Hotel manager: dashboard and reports")
public class HotelReportController {

    private final HotelReportService reports;

    public HotelReportController(HotelReportService reports) {
        this.reports = reports;
    }

    @GetMapping("/dashboard")
    @Operation(summary = "Today at the front desk, arrivals of the next 7 days and the range's figures",
            description = "Phase 11: ranges up to five years (also THIS_YEAR, LAST_12_MONTHS, LAST_5_YEARS, ...), "
                    + "interval=DAY|WEEK|MONTH|YEAR for the trend, comparison with the previous period.")
    public HotelDashboard dashboard(@PathVariable UUID hotelId,
            @RequestParam(defaultValue = ReportRanges.DEFAULT) String range,
            @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
            @RequestParam(required = false) String interval) {
        return reports.dashboard(hotelId, range, from, to, interval);
    }

    @GetMapping("/reports/occupancy")
    @Operation(summary = "Rooms available and sold per night, with totals")
    public OccupancyReport occupancy(@PathVariable UUID hotelId,
            @RequestParam(defaultValue = ReportRanges.DEFAULT) String range,
            @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        return reports.occupancy(hotelId, range, from, to);
    }

    @GetMapping("/reports/occupancy/export")
    @Operation(summary = "The occupancy report as CSV (UTF-8 with BOM)")
    public ResponseEntity<byte[]> occupancyExport(@PathVariable UUID hotelId,
            @RequestParam(defaultValue = "csv") String format,
            @RequestParam(defaultValue = ReportRanges.DEFAULT) String range,
            @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        CsvFile.requireCsv(format);
        return download(reports.occupancyCsv(hotelId, range, from, to));
    }

    @GetMapping("/reports/revenue")
    @Operation(summary = "Room revenue (without GST) and sold room-nights per night of stay, with totals")
    public RevenueReport revenue(@PathVariable UUID hotelId,
            @RequestParam(defaultValue = ReportRanges.DEFAULT) String range,
            @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        return reports.revenue(hotelId, range, from, to);
    }

    @GetMapping("/reports/revenue/export")
    @Operation(summary = "The revenue report as CSV (UTF-8 with BOM)")
    public ResponseEntity<byte[]> revenueExport(@PathVariable UUID hotelId,
            @RequestParam(defaultValue = "csv") String format,
            @RequestParam(defaultValue = ReportRanges.DEFAULT) String range,
            @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        CsvFile.requireCsv(format);
        return download(reports.revenueCsv(hotelId, range, from, to));
    }

    @GetMapping("/reports/room-types")
    @Operation(summary = "Room type performance: sold room-nights, room revenue (without GST) and ADR per type")
    public RoomTypeReport roomTypes(@PathVariable UUID hotelId,
            @RequestParam(defaultValue = ReportRanges.DEFAULT) String range,
            @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        return reports.roomTypes(hotelId, range, from, to);
    }

    /** A file download: never cached (the figures change with every booking). */
    static ResponseEntity<byte[]> download(CsvFile file) {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(CsvFile.CONTENT_TYPE))
                .header(HttpHeaders.CONTENT_DISPOSITION, file.contentDisposition())
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(file.content());
    }
}
