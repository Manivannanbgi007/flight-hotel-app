package com.flighthotel.hotel.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.flighthotel.hotel.entity.ReviewStatus;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Reviews (API_DOCUMENTATION.md §14.4): customers, the public hotel page, moderators and hotel managers. */
public final class ReviewDtos {

    private ReviewDtos() {
    }

    // ------------------------------------------------------------------ customers

    /** A completed stay the customer has not reviewed yet. */
    public record EligibleStay(UUID bookingId, String bookingReference, UUID hotelId, String hotelName,
                               String hotelSlug, LocalDate checkIn, LocalDate checkOut) {
    }

    public record CreateReviewRequest(
            @NotNull UUID bookingId,
            @NotNull @Min(1) @Max(5) Integer rating,
            @NotBlank @Size(min = 3, max = 100) String title,
            @NotBlank @Size(min = 20, max = 2000) String text) {
    }

    /** The author's own view of a review, any status. */
    public record MyReview(UUID id, UUID hotelId, String hotelName, String hotelSlug, UUID bookingId,
                           String bookingReference, int rating, String title, String text, String authorName,
                           String stayedIn, ReviewStatus status, String rejectionReason, Instant createdAt,
                           Instant moderatedAt) {
    }

    public record ReportReviewRequest(@NotBlank @Size(min = 5, max = 300) String reason) {
    }

    // ------------------------------------------------------------------ public

    public enum ReviewSort { RECENT, HIGHEST, LOWEST }

    /** An approved review as everyone sees it. @param stayedIn month of the stay, e.g. "Nov 2026" */
    public record PublicReview(UUID id, int rating, String title, String text, String authorName, String stayedIn,
                               Instant createdAt) {
    }

    /**
     * The written reviews of this site (approved ones). The hotel's own {@code guestRating}/{@code reviewCount}
     * also include the figures it started with (demo data), so they can differ from this summary.
     *
     * @param average      null when there is no approved review yet
     * @param distribution number of approved reviews per star ("5" … "1", always all five keys)
     */
    public record ReviewSummary(BigDecimal average, long count, Map<String, Long> distribution) {
    }

    /** A page of the hotel's approved reviews plus the summary of all of them. */
    public record HotelReviewsPage(List<PublicReview> content, int page, int size, long totalElements,
                                   int totalPages, ReviewSummary summary) {
    }

    /** Home page: a good recent review with the hotel it is about. */
    public record FeaturedReview(UUID id, int rating, String title, String text, String authorName,
                                 String stayedIn, Instant createdAt, UUID hotelId, String hotelName,
                                 String hotelSlug, String city) {
    }

    // ------------------------------------------------------------------ moderation

    public record ReviewReportItem(String reason, Instant createdAt) {
    }

    /**
     * @param reportCount reports not yet dealt with (a moderator's decision closes them)
     * @param reports     those open reports, oldest first
     */
    public record AdminReview(UUID id, UUID hotelId, String hotelName, String bookingReference, String authorName,
                              int rating, String title, String text, String stayedIn, ReviewStatus status,
                              int reportCount, List<ReviewReportItem> reports, Instant createdAt,
                              Instant moderatedAt, String rejectionReason) {
    }

    public record RejectReviewRequest(@NotBlank @Size(min = 5, max = 300) String reason) {
    }

    // ------------------------------------------------------------------ hotel managers (read only)

    public record ManagerReview(UUID id, int rating, String title, String text, String authorName,
                                String stayedIn, String bookingReference, ReviewStatus status, Instant createdAt,
                                Instant moderatedAt) {
    }

    /**
     * What the reviews of a hotel add up to (Phase 12). Everything but {@code pending} is about approved reviews, the
     * ones guests can read. {@code distribution} always has the keys 1 to 5; {@code months} has the last 12 months
     * (oldest first, also months without a review), with the number of reviews, their average rating and how many were
     * positive (4 or 5 stars) or negative (1 or 2 stars).
     */
    public record ManagerReviewSummary(BigDecimal average, long total, long fiveStar, long positive, long negative,
                                       long pending, Map<Integer, Long> distribution, List<ReviewMonth> months) {
    }

    public record ReviewMonth(String month, long reviews, BigDecimal average, long positive, long negative) {
    }
}
