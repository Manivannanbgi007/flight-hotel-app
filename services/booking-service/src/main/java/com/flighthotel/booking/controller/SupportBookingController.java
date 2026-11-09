package com.flighthotel.booking.controller;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.booking.dto.BookingDtos.AttentionView;
import com.flighthotel.booking.dto.BookingDtos.EscalateRequest;
import com.flighthotel.booking.dto.BookingDtos.RefundItem;
import com.flighthotel.booking.dto.BookingDtos.ResolveRequest;
import com.flighthotel.booking.dto.BookingDtos.SupportBookingRow;
import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.service.SupportBookingService;
import com.flighthotel.common.web.PageResponse;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/** Support agents' booking lookup and actions (permissions checked in {@link SupportBookingService}). */
@RestController
@RequestMapping("/api/support/bookings")
@Tag(name = "Support: bookings", description = "Booking lookup, Needs attention queue, escalations, refund retries")
public class SupportBookingController {

    private final SupportBookingService support;

    public SupportBookingController(SupportBookingService support) {
        this.support = support;
    }

    @GetMapping
    @Operation(summary = "Find bookings by reference, e-mail, PNR or confirmation number (BOOKING_READ_ANY)")
    public PageResponse<SupportBookingRow> search(@RequestParam(required = false) String q,
            @RequestParam(required = false) BookingStatus status, @RequestParam(required = false) BookingType type,
            @RequestParam(defaultValue = "false") boolean attention, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return support.search(q, status, type, attention, page, size);
    }

    @PostMapping("/{bookingId}/escalate")
    @Operation(summary = "Put the booking in the Needs attention queue with a note (BOOKING_MANAGE_ANY)")
    public AttentionView escalate(@PathVariable UUID bookingId, @Valid @RequestBody EscalateRequest request) {
        return support.escalate(bookingId, request.note());
    }

    @PostMapping("/{bookingId}/resolve")
    @Operation(summary = "Take the booking out of the Needs attention queue (BOOKING_MANAGE_ANY)")
    public ResponseEntity<Void> resolve(@PathVariable UUID bookingId,
            @Valid @RequestBody(required = false) ResolveRequest request) {
        support.resolve(bookingId, request == null ? null : request.note());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{bookingId}/retry-refund")
    @Operation(summary = "Send the failed refund of the booking again (REFUND_MANAGE)")
    public ResponseEntity<RefundItem> retryRefund(@PathVariable UUID bookingId) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(support.retryRefund(bookingId));
    }
}
