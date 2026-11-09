package com.flighthotel.reporting.controller;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.reporting.export.AuditExportService;
import com.flighthotel.reporting.export.AuditExportService.Download;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * The file of a ready export, behind a one-time link from {@code POST /api/admin/audit-logs/exports/{id}/link}. No
 * login: the browser's download manager opens the link (it cannot send the access token), so the token in the link is
 * the permission; it works once, for 60 seconds. The file is streamed, never loaded into memory.
 */
@RestController
@Tag(name = "Admin: Audit logs")
public class PublicExportFileController {

    private final AuditExportService exports;

    public PublicExportFileController(AuditExportService exports) {
        this.exports = exports;
    }

    @GetMapping("/api/public/export-files/{id}")
    @Operation(summary = "Download an export through its one-time link (the token is the permission)")
    public ResponseEntity<Resource> download(@PathVariable UUID id,
            @RequestParam(required = false) String token) {
        Download download = exports.download(id, token);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(download.contentType()))
                .contentLength(download.file().size())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(download.fileName(), StandardCharsets.UTF_8).build().toString())
                .cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff")
                .body(new InputStreamResource(download.file().content()));
    }
}
