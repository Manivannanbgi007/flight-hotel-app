package com.flighthotel.booking.controller;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.booking.dto.BookingDtos.CouponCheckRequest;
import com.flighthotel.booking.dto.BookingDtos.CouponCheckResponse;
import com.flighthotel.booking.service.CouponService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/coupons")
@Tag(name = "Coupons", description = "Check a coupon before booking")
public class CouponController {

    private final CouponService coupons;

    public CouponController(CouponService coupons) {
        this.coupons = coupons;
    }

    @PostMapping("/check")
    @Operation(summary = "Preview the discount of a coupon (the booking recalculates it from the held price)")
    public CouponCheckResponse check(@Valid @RequestBody CouponCheckRequest request) {
        return coupons.preview(request);
    }
}
