package com.flighthotel.hotel.controller;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.hotel.dto.FrontDeskDtos.DateField;
import com.flighthotel.hotel.dto.FrontDeskDtos.HotelCancelRequest;
import com.flighthotel.hotel.dto.FrontDeskDtos.ReservationDetails;
import com.flighthotel.hotel.dto.FrontDeskDtos.ReservationRow;
import com.flighthotel.hotel.dto.FrontDeskDtos.ReservationSummary;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.frontdesk.FrontDeskService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/**
 * Hotel manager portal: reservations, guests, check-in/out, no-show and the hotel's own cancellations
 * (API_DOCUMENTATION.md §14.5). Managers reach only their assigned hotels; admins reach all (HotelAccess).
 */
@RestController
@RequestMapping("/api/hotel-manager/hotels/{hotelId}/reservations")
@Tag(name = "Hotel manager: reservations")
public class HotelFrontDeskController {

    private final FrontDeskService frontDesk;

    public HotelFrontDeskController(FrontDeskService frontDesk) {
        this.frontDesk = frontDesk;
    }

    @GetMapping
    @Operation(summary = "Reservations of the hotel",
            description = "status=CONFIRMED,CHECKED_IN (none: every paid reservation; HELD, EXPIRED and RELEASED only "
                    + "when asked for). from/to (inclusive) filter the check-in date or, with dateField=CREATED, the "
                    + "booking date. q: booking reference, confirmation number or guest name. "
                    + "sort=checkIn|checkOut|createdAt|totalAmount|bookingReference|status,asc|desc "
                    + "(default createdAt,desc).")
    public PageResponse<ReservationRow> list(@PathVariable UUID hotelId,
            @RequestParam(required = false) List<ReservationStatus> status,
            @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
            @RequestParam(defaultValue = "CHECK_IN") DateField dateField, @RequestParam(required = false) String q,
            @RequestParam(required = false) UUID roomTypeId, @PageableDefault(size = 20) Pageable pageable) {
        return frontDesk.list(hotelId, status, from, to, dateField, q, roomTypeId, pageable);
    }

    @GetMapping("/summary")
    @Operation(summary = "Reservation counts per status for the same filters as the list (not the status)")
    public ReservationSummary summary(@PathVariable UUID hotelId, @RequestParam(required = false) LocalDate from,
            @RequestParam(required = false) LocalDate to, @RequestParam(defaultValue = "CHECK_IN") DateField dateField,
            @RequestParam(required = false) String q, @RequestParam(required = false) UUID roomTypeId) {
        return frontDesk.summary(hotelId, from, to, dateField, q, roomTypeId);
    }

    @GetMapping("/{reservationId}")
    @Operation(summary = "A reservation with its guests and contact details")
    public ReservationDetails details(@PathVariable UUID hotelId, @PathVariable UUID reservationId) {
        return frontDesk.details(hotelId, reservationId);
    }

    @PostMapping("/{reservationId}/check-in")
    @Operation(summary = "Check the guests in (from the check-in day until the check-out time, hotel time)")
    public ReservationDetails checkIn(@PathVariable UUID hotelId, @PathVariable UUID reservationId) {
        return frontDesk.checkIn(hotelId, reservationId);
    }

    @PostMapping("/{reservationId}/check-out")
    @Operation(summary = "Check the guests out (also early: the remaining nights go back on sale)")
    public ReservationDetails checkOut(@PathVariable UUID hotelId, @PathVariable UUID reservationId) {
        return frontDesk.checkOut(hotelId, reservationId);
    }

    @PostMapping("/{reservationId}/no-show")
    @Operation(summary = "The guests never arrived (from the day after the check-in date)")
    public ReservationDetails noShow(@PathVariable UUID hotelId, @PathVariable UUID reservationId) {
        return frontDesk.noShow(hotelId, reservationId);
    }

    @PostMapping("/{reservationId}/cancel")
    @Operation(summary = "The hotel cancels a confirmed stay (until the check-in day); the guest is refunded in full")
    public ReservationDetails cancel(@PathVariable UUID hotelId, @PathVariable UUID reservationId,
            @Valid @RequestBody HotelCancelRequest request) {
        return frontDesk.cancel(hotelId, reservationId, request.reason());
    }
}
