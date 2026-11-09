package com.flighthotel.reporting.controller;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.analytics.DayRange;
import com.flighthotel.common.analytics.Interval;
import com.flighthotel.common.error.ApiException;
import com.flighthotel.reporting.report.DashboardService;
import com.flighthotel.reporting.report.DashboardService.Dashboard;
import com.flighthotel.reporting.report.DashboardService.PopularDestination;
import com.flighthotel.reporting.report.DashboardService.PopularRoute;
import com.flighthotel.reporting.report.ReportExporter;
import com.flighthotel.reporting.report.ReportRange;
import com.flighthotel.reporting.report.ReportService;
import com.flighthotel.reporting.report.ReportService.Filters;
import com.flighthotel.reporting.report.ReportService.ReportPage;
import com.flighthotel.reporting.report.ReportService.ReportRows;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** The admin dashboard and reports (REPORT_VIEW, checked in the services) and the home page's public figures. */
@RestController
@Tag(name = "Reports", description = "Admin dashboard, reports with CSV/PDF export, public home page figures")
public class AdminReportController {

    private final DashboardService dashboards;
    private final ReportService reports;
    private final ReportExporter exporter;
    private final Clock clock;

    public AdminReportController(DashboardService dashboards, ReportService reports, ReportExporter exporter,
            Clock clock) {
        this.dashboards = dashboards;
        this.reports = reports;
        this.exporter = exporter;
        this.clock = clock;
    }

    @GetMapping("/api/admin/dashboard")
    @Operation(summary = "Every dashboard figure for the range (REPORT_VIEW)",
            description = "range: a preset or CUSTOM (from, to), at most five years. interval: DAY, WEEK, MONTH or "
                    + "YEAR for the series (default by the length of the range).")
    public Dashboard dashboard(@RequestParam(required = false) String range,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String interval) {
        ReportRange resolved = ReportRange.of(range, from, to, clock, DayRange.FIVE_YEARS);
        return dashboards.dashboard(resolved, Interval.resolve(interval, resolved.toDayRange()));
    }

    @GetMapping("/api/admin/reports/{report}")
    @Operation(summary = "One page of a report with totals over all rows (REPORT_VIEW)")
    public ReportPage report(@PathVariable String report, @RequestParam(required = false) String range,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String q, @RequestParam(required = false) String type,
            @RequestParam(required = false) String status, @RequestParam(required = false) String sort,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return reports.page(report, ReportRange.of(range, from, to, clock), new Filters(q, type, status, sort), page,
                size);
    }

    @GetMapping("/api/admin/reports/{report}/export")
    @Operation(summary = "The whole report as CSV or PDF, at most 10,000 rows (REPORT_VIEW)")
    public ResponseEntity<byte[]> export(@PathVariable String report, @RequestParam(defaultValue = "csv") String format,
            @RequestParam(required = false) String range,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String q, @RequestParam(required = false) String type,
            @RequestParam(required = false) String status, @RequestParam(required = false) String sort) {
        if (!"csv".equals(format) && !"pdf".equals(format)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_FORMAT", "format must be csv or pdf.");
        }
        ReportRows rows = reports.all(report, ReportRange.of(range, from, to, clock),
                new Filters(q, type, status, sort));
        boolean csv = "csv".equals(format);
        return ResponseEntity.ok()
                .contentType(csv ? new MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8)
                        : MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(ReportExporter.fileName(rows, format)).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .cacheControl(CacheControl.noStore())
                .body(csv ? exporter.csv(rows) : exporter.pdf(rows));
    }

    @GetMapping("/api/public/popular-destinations")
    @Operation(summary = "Most booked cities of the last 90 days (public)")
    public ResponseEntity<List<PopularDestination>> popularDestinations(@RequestParam(defaultValue = "8") int limit) {
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(java.time.Duration.ofMinutes(5)).cachePublic())
                .body(dashboards.popularDestinations(limit));
    }

    @GetMapping("/api/public/popular-routes")
    @Operation(summary = "Most booked flight routes of the last 90 days (public)")
    public ResponseEntity<List<PopularRoute>> popularRoutes(@RequestParam(defaultValue = "6") int limit) {
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(java.time.Duration.ofMinutes(5)).cachePublic())
                .body(dashboards.popularRoutes(limit));
    }
}
