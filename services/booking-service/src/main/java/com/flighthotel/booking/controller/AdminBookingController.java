package com.flighthotel.booking.controller;

import java.time.LocalDate;
import java.util.UUID;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.booking.dto.AdminDtos.AdminBookingRow;
import com.flighthotel.booking.dto.AdminDtos.GoodwillRefundRequest;
import com.flighthotel.booking.dto.BookingDtos.RefundItem;
import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.service.SupportBookingService;
import com.flighthotel.common.web.PageResponse;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/** Admin portal: booking management (permissions checked in {@link SupportBookingService}). */
@RestController
@RequestMapping("/api/admin/bookings")
@Tag(name = "Admin: bookings", description = "Booking search with dates and sorting, goodwill refunds")
public class AdminBookingController {

    private final SupportBookingService support;

    public AdminBookingController(SupportBookingService support) {
        this.support = support;
    }

    @GetMapping
    @Operation(summary = "Search bookings by reference, e-mail, PNR or confirmation number, status, type and creation "
            + "date (BOOKING_READ_ANY)")
    public PageResponse<AdminBookingRow> search(@RequestParam(required = false) String q,
            @RequestParam(required = false) BookingStatus status, @RequestParam(required = false) BookingType type,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "false") boolean attention, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size, @RequestParam(required = false) String sort) {
        return support.adminSearch(q, status, type, from, to, attention, page, size, sort);
    }

    @PostMapping("/{bookingId}/refunds")
    @Operation(summary = "Goodwill refund: give money back while the booking stands (REFUND_MANAGE)")
    public ResponseEntity<RefundItem> goodwillRefund(@PathVariable UUID bookingId,
            @Valid @RequestBody GoodwillRefundRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(support.goodwillRefund(bookingId, request,
                idempotencyKey));
    }
}
