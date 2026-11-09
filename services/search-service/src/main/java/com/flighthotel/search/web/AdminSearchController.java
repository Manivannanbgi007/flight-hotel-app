package com.flighthotel.search.web;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.search.index.SearchIndexUnavailableException;
import com.flighthotel.search.sync.IndexMaintenance;
import com.flighthotel.search.sync.IndexMaintenance.IndexStatus;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** Index maintenance for administrators (the service layer checks the ADMIN role). */
@RestController
@RequestMapping("/api/admin/search")
@Tag(name = "Search administration", description = "Search index status and recovery (admins)")
public class AdminSearchController {

    private final IndexMaintenance maintenance;

    public AdminSearchController(IndexMaintenance maintenance) {
        this.maintenance = maintenance;
    }

    @GetMapping("/status")
    @Operation(summary = "Documents in the search index per category")
    public IndexStatus status() {
        try {
            return maintenance.status();
        } catch (SearchIndexUnavailableException ex) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "SEARCH_UNAVAILABLE",
                    "Search is not available right now. Try again in a moment.");
        }
    }

    @PostMapping("/replay")
    @Operation(summary = "Apply the events Kafka still keeps (7 days) again, and rebuild pages and destinations")
    public ResponseEntity<Map<String, Object>> replay() {
        int listeners = maintenance.replay();
        return ResponseEntity.accepted().body(Map.of("listeners", listeners,
                "message", "Replay started; the index catches up in the background."));
    }
}
