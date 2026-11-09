package com.flighthotel.booking.controller;

import java.net.URI;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
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

import com.flighthotel.booking.dto.BookingDtos.BookingDetails;
import com.flighthotel.booking.dto.BookingDtos.BookingSummary;
import com.flighthotel.booking.dto.BookingDtos.CancelRequest;
import com.flighthotel.booking.dto.BookingDtos.CancellationQuoteView;
import com.flighthotel.booking.dto.BookingDtos.CancellationView;
import com.flighthotel.booking.dto.BookingDtos.CreateFlightBookingRequest;
import com.flighthotel.booking.dto.BookingDtos.CreateHotelBookingRequest;
import com.flighthotel.booking.dto.BookingDtos.TimelineEntry;
import com.flighthotel.booking.dto.SummaryDtos.CustomerSummary;
import com.flighthotel.booking.entity.BookingTab;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.service.BookingQueryService;
import com.flighthotel.booking.service.CancellationService;
import com.flighthotel.booking.service.CustomerSummaryService;
import com.flighthotel.booking.service.FlightBookingService;
import com.flighthotel.booking.service.HotelBookingService;
import com.flighthotel.booking.service.HotelBookingService.Submitted;
import com.flighthotel.common.web.PageResponse;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/** The customer's bookings (any logged-in user; own bookings only). */
@RestController
@RequestMapping("/api/bookings")
@Tag(name = "Bookings", description = "Book a hotel or flight, My Trips, details, timeline and cancellation")
public class BookingController {

    private final HotelBookingService hotelBookings;
    private final FlightBookingService flightBookings;
    private final BookingQueryService queries;
    private final CancellationService cancellations;
    private final CustomerSummaryService summaries;

    public BookingController(HotelBookingService hotelBookings, FlightBookingService flightBookings,
            BookingQueryService queries, CancellationService cancellations, CustomerSummaryService summaries) {
        this.hotelBookings = hotelBookings;
        this.flightBookings = flightBookings;
        this.queries = queries;
        this.cancellations = cancellations;
        this.summaries = summaries;
    }

    @PostMapping("/hotel")
    @Operation(summary = "Book the stay of a quote (202: the rooms are held asynchronously; poll the booking)")
    public ResponseEntity<BookingDetails> bookHotel(@Valid @RequestBody CreateHotelBookingRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        Submitted submitted;
        try {
            submitted = hotelBookings.create(request, idempotencyKey);
        } catch (DataIntegrityViolationException sameKeyAtTheSameTime) {
            submitted = hotelBookings.repeated(request, idempotencyKey);
        }
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .location(URI.create("/api/bookings/" + submitted.bookingId()))
                .body(queries.details(submitted.bookingId()));
    }

    @PostMapping("/flight")
    @Operation(summary = "Book the trip of a revalidated offer (202: the seats are held asynchronously; poll the booking)")
    public ResponseEntity<BookingDetails> bookFlight(@Valid @RequestBody CreateFlightBookingRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        Submitted submitted;
        try {
            submitted = flightBookings.create(request, idempotencyKey);
        } catch (DataIntegrityViolationException sameKeyAtTheSameTime) {
            submitted = flightBookings.repeated(request, idempotencyKey);
        }
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .location(URI.create("/api/bookings/" + submitted.bookingId()))
                .body(queries.details(submitted.bookingId()));
    }

    @GetMapping
    @Operation(summary = "My Trips: my bookings, newest first, filtered by tab, type and search words")
    public PageResponse<BookingSummary> myBookings(@RequestParam(defaultValue = "ALL") BookingTab tab,
            @RequestParam(required = false) String q, @RequestParam(required = false) BookingType type,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "10") int size) {
        return queries.myBookings(tab, q, type, page, size);
    }

    @GetMapping("/summary")
    @Operation(summary = "My dashboard: my bookings, trips, spending, monthly activity and next trip (own only)",
            description = "range: a preset (default LAST_12_MONTHS), CUSTOM (from, to; at most five years) or "
                    + "ALL_TIME.")
    public CustomerSummary summary(@RequestParam(required = false) String range,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return summaries.summary(range, from, to);
    }

    @GetMapping("/{bookingId}")
    @Operation(summary = "Booking details (owner, or BOOKING_READ_ANY)")
    public BookingDetails details(@PathVariable UUID bookingId) {
        return queries.details(bookingId);
    }

    @GetMapping("/{bookingId}/timeline")
    @Operation(summary = "Every status change of the booking, oldest first")
    public List<TimelineEntry> timeline(@PathVariable UUID bookingId) {
        return queries.timeline(bookingId);
    }

    @GetMapping("/{bookingId}/cancellation-quote")
    @Operation(summary = "What cancelling now costs and returns (waiveFee: REFUND_MANAGE only)")
    public CancellationQuoteView cancellationQuote(@PathVariable UUID bookingId,
            @RequestParam(defaultValue = "false") boolean waiveFee) {
        return cancellations.quote(bookingId, waiveFee);
    }

    @PostMapping("/{bookingId}/cancel")
    @Operation(summary = "Cancel (202: the hotel or airline confirms asynchronously; follow the booking)")
    public ResponseEntity<CancellationView> cancel(@PathVariable UUID bookingId,
            @Valid @RequestBody(required = false) CancelRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(cancellations.cancel(bookingId, request, idempotencyKey));
    }
}
