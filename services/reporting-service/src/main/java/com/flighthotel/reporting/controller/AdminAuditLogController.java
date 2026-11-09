package com.flighthotel.reporting.controller;

import java.time.Instant;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.reporting.audit.AuditLogStore;
import com.flighthotel.reporting.audit.AuditLogStore.AuditLogEntry;
import com.flighthotel.reporting.audit.AuditLogStore.Filter;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

@RestController
@RequestMapping("/api/admin/audit-logs")
@Tag(name = "Admin: Audit logs")
public class AdminAuditLogController {

    private final AuditLogStore store;

    public AdminAuditLogController(AuditLogStore store) {
        this.store = store;
    }

    @GetMapping
    @Operation(summary = "Search the audit trail, newest first (ADMIN)")
    public PageResponse<AuditLogEntry> search(@RequestParam(required = false) String action,
            @RequestParam(required = false) String entityType, @RequestParam(required = false) String entityId,
            @RequestParam(required = false) String actorId, @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return store.search(new Filter(action, entityType, entityId, actorId, from, to), page, size);
    }
}
