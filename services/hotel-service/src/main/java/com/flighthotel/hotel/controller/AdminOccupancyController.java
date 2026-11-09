package com.flighthotel.hotel.controller;

import java.time.LocalDate;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.hotel.dto.ReportDtos.OccupancyOverview;
import com.flighthotel.hotel.report.AdminOccupancyService;
import com.flighthotel.hotel.report.CsvFile;
import com.flighthotel.hotel.report.ReportRanges;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** Occupancy and revenue of all hotels for admins (role ADMIN, checked in AdminOccupancyService). */
@RestController
@RequestMapping("/api/admin/hotels/occupancy")
@Tag(name = "Admin: Hotels")
public class AdminOccupancyController {

    private final AdminOccupancyService occupancy;

    public AdminOccupancyController(AdminOccupancyService occupancy) {
        this.occupancy = occupancy;
    }

    @GetMapping
    @Operation(summary = "Room-nights, booked room-nights, occupancy and revenue per hotel for a range")
    public OccupancyOverview overview(@RequestParam(defaultValue = ReportRanges.DEFAULT) String range,
            @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        return occupancy.overview(range, from, to);
    }

    @GetMapping("/export")
    @Operation(summary = "The same as CSV (UTF-8 with BOM)")
    public ResponseEntity<byte[]> export(@RequestParam(defaultValue = "csv") String format,
            @RequestParam(defaultValue = ReportRanges.DEFAULT) String range,
            @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        CsvFile.requireCsv(format);
        return HotelReportController.download(occupancy.overviewCsv(range, from, to));
    }
}
