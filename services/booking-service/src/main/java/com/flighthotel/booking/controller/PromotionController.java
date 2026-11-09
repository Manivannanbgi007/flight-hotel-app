package com.flighthotel.booking.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.booking.dto.AdminDtos.CouponRequest;
import com.flighthotel.booking.dto.AdminDtos.CouponView;
import com.flighthotel.booking.dto.AdminDtos.OfferRequest;
import com.flighthotel.booking.dto.AdminDtos.OfferView;
import com.flighthotel.booking.dto.AdminDtos.PublicOfferView;
import com.flighthotel.booking.dto.AdminDtos.StatusRequest;
import com.flighthotel.booking.service.PromotionService;
import com.flighthotel.common.web.PageResponse;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/** Current offers (public) and the admin portal's coupons and offers (COUPON_MANAGE, checked in the service). */
@RestController
@Tag(name = "Offers and coupons", description = "Public offers; coupon and offer management")
public class PromotionController {

    private final PromotionService promotions;

    public PromotionController(PromotionService promotions) {
        this.promotions = promotions;
    }

    @GetMapping("/api/offers")
    @Operation(summary = "Current offers with their coupon code (public)")
    public ResponseEntity<List<PublicOfferView>> offers() {
        return ResponseEntity.ok().cacheControl(CacheControl.noCache()).body(promotions.liveOffers());
    }

    // ------------------------------------------------------------------ coupons

    @GetMapping("/api/admin/coupons")
    @Operation(summary = "Coupons with their usage (COUPON_MANAGE)")
    public PageResponse<CouponView> coupons(@RequestParam(required = false) String q,
            @RequestParam(required = false) String status, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return promotions.coupons(q, status, page, size);
    }

    @GetMapping("/api/admin/coupons/{id}")
    @Operation(summary = "One coupon (COUPON_MANAGE)")
    public CouponView coupon(@PathVariable UUID id) {
        return promotions.coupon(id);
    }

    @PostMapping("/api/admin/coupons")
    @Operation(summary = "Create a coupon (COUPON_MANAGE)")
    public ResponseEntity<CouponView> createCoupon(@Valid @RequestBody CouponRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(promotions.createCoupon(request));
    }

    @PutMapping("/api/admin/coupons/{id}")
    @Operation(summary = "Change a coupon; the code stays (COUPON_MANAGE)")
    public CouponView updateCoupon(@PathVariable UUID id, @Valid @RequestBody CouponRequest request) {
        return promotions.updateCoupon(id, request);
    }

    @PatchMapping("/api/admin/coupons/{id}/status")
    @Operation(summary = "Activate or deactivate a coupon (COUPON_MANAGE)")
    public CouponView couponStatus(@PathVariable UUID id, @Valid @RequestBody StatusRequest request) {
        return promotions.couponStatus(id, request.status());
    }

    // ------------------------------------------------------------------ offers

    @GetMapping("/api/admin/offers")
    @Operation(summary = "All offers (COUPON_MANAGE)")
    public PageResponse<OfferView> adminOffers(@RequestParam(required = false) String q,
            @RequestParam(required = false) String status, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return promotions.offers(q, status, page, size);
    }

    @PostMapping("/api/admin/offers")
    @Operation(summary = "Create an offer for a coupon (COUPON_MANAGE)")
    public ResponseEntity<OfferView> createOffer(@Valid @RequestBody OfferRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(promotions.createOffer(request));
    }

    @PutMapping("/api/admin/offers/{id}")
    @Operation(summary = "Change an offer (COUPON_MANAGE)")
    public OfferView updateOffer(@PathVariable UUID id, @Valid @RequestBody OfferRequest request) {
        return promotions.updateOffer(id, request);
    }

    @PatchMapping("/api/admin/offers/{id}/status")
    @Operation(summary = "Show or hide an offer (COUPON_MANAGE)")
    public OfferView offerStatus(@PathVariable UUID id, @Valid @RequestBody StatusRequest request) {
        return promotions.offerStatus(id, request.status());
    }
}
