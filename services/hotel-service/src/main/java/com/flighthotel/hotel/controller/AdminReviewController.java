package com.flighthotel.hotel.controller;

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
import com.flighthotel.hotel.dto.ReviewDtos.AdminReview;
import com.flighthotel.hotel.dto.ReviewDtos.RejectReviewRequest;
import com.flighthotel.hotel.entity.ReviewStatus;
import com.flighthotel.hotel.review.ReviewModerationService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/** Review moderation (permission REVIEW_MODERATE, checked in ReviewModerationService). */
@RestController
@RequestMapping("/api/admin/reviews")
@Tag(name = "Admin: Reviews")
public class AdminReviewController {

    private final ReviewModerationService moderation;

    public AdminReviewController(ReviewModerationService moderation) {
        this.moderation = moderation;
    }

    @GetMapping
    @Operation(summary = "Reviews to moderate",
            description = "reported=true: reviews with reports nobody dealt with yet. q: booking reference, hotel, "
                    + "author or title. sort=createdAt|rating|moderatedAt,asc|desc (default createdAt,desc).")
    public PageResponse<AdminReview> list(@RequestParam(required = false) ReviewStatus status,
            @RequestParam(required = false) Boolean reported, @RequestParam(required = false) String q,
            @PageableDefault(size = 20) Pageable pageable) {
        return moderation.list(status, reported, q, pageable);
    }

    @PostMapping("/{reviewId}/approve")
    @Operation(summary = "Publish a review (or keep a reported one); closes its open reports")
    public AdminReview approve(@PathVariable UUID reviewId) {
        return moderation.approve(reviewId);
    }

    @PostMapping("/{reviewId}/reject")
    @Operation(summary = "Reject a review (or take a published one down) with a reason the author sees")
    public AdminReview reject(@PathVariable UUID reviewId, @Valid @RequestBody RejectReviewRequest request) {
        return moderation.reject(reviewId, request.reason());
    }
}
