package com.flighthotel.hotel.controller;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.hotel.dto.ManagerDtos.AssignManagerRequest;
import com.flighthotel.hotel.dto.ManagerDtos.ChangeHotelStatusRequest;
import com.flighthotel.hotel.dto.ManagerDtos.CreateHotelRequest;
import com.flighthotel.hotel.dto.ManagerDtos.HotelSummary;
import com.flighthotel.hotel.dto.ManagerDtos.ManagerItem;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.manager.AdminHotelService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/** Admin hotel management (role ADMIN). Hotel content is edited through the hotel manager API. */
@RestController
@RequestMapping("/api/admin/hotels")
@Tag(name = "Admin: Hotels")
public class AdminHotelController {

    private final AdminHotelService adminHotels;

    public AdminHotelController(AdminHotelService adminHotels) {
        this.adminHotels = adminHotels;
    }

    @GetMapping
    @Operation(summary = "All hotels (search by name or city, filter by status)")
    public PageResponse<HotelSummary> list(@RequestParam(required = false) String search,
            @RequestParam(required = false) HotelStatus status, @PageableDefault(size = 20) Pageable pageable) {
        return adminHotels.list(search, status, pageable);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a hotel (DRAFT)")
    public HotelSummary create(@Valid @RequestBody CreateHotelRequest request) {
        return adminHotels.create(request);
    }

    @PatchMapping("/{hotelId}/status")
    @Operation(summary = "Publish (ACTIVE) or unpublish (INACTIVE)")
    public HotelSummary changeStatus(@PathVariable UUID hotelId, @Valid @RequestBody ChangeHotelStatusRequest request) {
        return adminHotels.changeStatus(hotelId, request);
    }

    @GetMapping("/{hotelId}/managers")
    @Operation(summary = "Hotel managers assigned to the hotel")
    public List<ManagerItem> managers(@PathVariable UUID hotelId) {
        return adminHotels.managers(hotelId);
    }

    @PostMapping("/{hotelId}/managers")
    @Operation(summary = "Assign a hotel manager by email")
    public List<ManagerItem> assignManager(@PathVariable UUID hotelId, @Valid @RequestBody AssignManagerRequest request) {
        return adminHotels.assignManager(hotelId, request.email());
    }

    @DeleteMapping("/{hotelId}/managers/{userId}")
    @Operation(summary = "Remove a hotel manager from the hotel")
    public List<ManagerItem> unassignManager(@PathVariable UUID hotelId, @PathVariable UUID userId) {
        return adminHotels.unassignManager(hotelId, userId);
    }

    @PostMapping("/reindex")
    @Operation(summary = "Rebuild the search index from the database")
    public Map<String, Integer> reindex() {
        return Map.of("indexed", adminHotels.reindex());
    }
}
