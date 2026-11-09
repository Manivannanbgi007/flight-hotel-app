package com.flighthotel.reporting.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.reporting.export.AuditExportService;
import com.flighthotel.reporting.export.ExportDtos.ExportJobResponse;
import com.flighthotel.reporting.export.ExportDtos.ExportLinkResponse;
import com.flighthotel.reporting.export.ExportDtos.ExportRequest;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/admin/audit-logs/exports")
@Tag(name = "Admin: Audit logs")
public class AdminAuditExportController {

    private final AuditExportService exports;

    public AdminAuditExportController(AuditExportService exports) {
        this.exports = exports;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Export every matching entry as Excel or CSV, written in the background (ADMIN)")
    public ExportJobResponse request(@Valid @RequestBody ExportRequest request) {
        return exports.request(request);
    }

    @GetMapping
    @Operation(summary = "Your exports of the last 7 days, newest first (ADMIN)")
    public List<ExportJobResponse> list() {
        return exports.list();
    }

    @GetMapping("/{id}")
    @Operation(summary = "One of your exports (ADMIN)")
    public ExportJobResponse get(@PathVariable UUID id) {
        return exports.get(id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Cancel a waiting or running export, or remove a finished one with its file (ADMIN)")
    public void remove(@PathVariable UUID id) {
        exports.remove(id);
    }

    @PostMapping("/{id}/link")
    @Operation(summary = "A one-time download link for a ready export, valid for 60 seconds (ADMIN)")
    public ExportLinkResponse link(@PathVariable UUID id) {
        return exports.link(id);
    }
}
