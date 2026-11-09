package com.flighthotel.hotel.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.hotel.dto.ReviewDtos.CreateReviewRequest;
import com.flighthotel.hotel.dto.ReviewDtos.EligibleStay;
import com.flighthotel.hotel.dto.ReviewDtos.FeaturedReview;
import com.flighthotel.hotel.dto.ReviewDtos.MyReview;
import com.flighthotel.hotel.dto.ReviewDtos.ReportReviewRequest;
import com.flighthotel.hotel.review.PublicReviewService;
import com.flighthotel.hotel.review.ReviewService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/**
 * Reviews of stays (API_DOCUMENTATION.md §14.4). Writing and reporting need a login; {@code /featured} is public
 * (travel.security.public-paths). A hotel's reviews are under {@code /api/hotels/{idOrSlug}/reviews}.
 */
@RestController
@RequestMapping("/api/reviews")
@Tag(name = "Reviews")
public class ReviewController {

    private final ReviewService reviews;
    private final PublicReviewService publicReviews;

    public ReviewController(ReviewService reviews, PublicReviewService publicReviews) {
        this.reviews = reviews;
        this.publicReviews = publicReviews;
    }

    @GetMapping("/eligible")
    @Operation(summary = "My completed stays I have not reviewed yet")
    public List<EligibleStay> eligible() {
        return reviews.eligible();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Review a completed stay (published after moderation)",
            description = "422 NOT_ELIGIBLE: not my stay or not completed; 409 ALREADY_REVIEWED. Photos are not "
                    + "supported (reviews.photos.enabled = false).")
    public MyReview create(@Valid @RequestBody CreateReviewRequest request) {
        return reviews.create(request);
    }

    @GetMapping("/mine")
    @Operation(summary = "My reviews in any status, newest first (with the reason when rejected)")
    public PageResponse<MyReview> mine(@RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return reviews.mine(page, size);
    }

    @PostMapping("/{reviewId}/report")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Report a published review to the moderators (once; never your own)")
    public void report(@PathVariable UUID reviewId, @Valid @RequestBody ReportReviewRequest request) {
        reviews.report(reviewId, request.reason());
    }

    @GetMapping("/featured")
    @Operation(summary = "Good recent reviews for the home page (public)")
    public List<FeaturedReview> featured(@RequestParam(defaultValue = "6") int limit) {
        return publicReviews.featured(limit);
    }
}
