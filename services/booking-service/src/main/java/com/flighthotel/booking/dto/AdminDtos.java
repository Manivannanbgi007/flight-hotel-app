package com.flighthotel.booking.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.PaymentStatus;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Request and response bodies of the admin portal's booking, coupon and offer APIs (API_DOCUMENTATION.md 14.2). */
public final class AdminDtos {

    private AdminDtos() {
    }

    // ------------------------------------------------------------------ bookings

    /** The support lookup row plus the customer's id and the money already back with them. */
    public record AdminBookingRow(UUID id, String reference, BookingType type, BookingStatus status,
                                  PaymentStatus paymentStatus, String title, String destination, LocalDate startDate,
                                  LocalDate endDate, BigDecimal totalAmount, BigDecimal refundedAmount,
                                  String currency, Instant createdAt, UUID userId, String contactEmail, String leadName,
                                  String attentionReason, Instant attentionSince, boolean demo) {
    }

    public record GoodwillRefundRequest(
            @NotNull @DecimalMin("1.00") @Digits(integer = 10, fraction = 2) BigDecimal amount,
            @NotBlank @Size(min = 5, max = 500) String reason) {
    }

    // ------------------------------------------------------------------ coupons

    public record CouponView(UUID id, String code, String title, String description, String discountType,
                             BigDecimal discountValue, BigDecimal maxDiscount, BigDecimal minBookingAmount,
                             String appliesTo, String destinationCity, Instant validFrom, Instant validTo,
                             Integer usageLimit, int perCustomerLimit, int usedCount, long reservedCount,
                             long consumedCount, String status, boolean expired, boolean demo, Long version,
                             Instant createdAt, Instant updatedAt) {
    }

    /** Create ({@code code} required) or update ({@code version} expected; the code cannot change). */
    public record CouponRequest(
            @Pattern(regexp = "^[A-Za-z0-9-]{3,30}$", message = "3 to 30 letters, digits or '-'") String code,
            @NotBlank @Size(min = 3, max = 100) String title,
            @Size(max = 500) String description,
            @NotNull @Pattern(regexp = "PERCENT|FIXED") String discountType,
            @NotNull @DecimalMin("0.01") @Digits(integer = 10, fraction = 2) BigDecimal discountValue,
            @DecimalMin("0.01") @Digits(integer = 10, fraction = 2) BigDecimal maxDiscount,
            @DecimalMin("0.00") @Digits(integer = 10, fraction = 2) BigDecimal minBookingAmount,
            @Pattern(regexp = "ALL|FLIGHT|HOTEL") String appliesTo,
            @Size(max = 100) String destinationCity,
            @NotNull Instant validFrom,
            @NotNull Instant validTo,
            @Min(1) @Max(1_000_000) Integer usageLimit,
            @Min(1) @Max(100) Integer perCustomerLimit,
            @Pattern(regexp = "ACTIVE|INACTIVE") String status,
            Long version) {
    }

    public record StatusRequest(@NotNull @Pattern(regexp = "ACTIVE|INACTIVE") String status) {
    }

    // ------------------------------------------------------------------ offers

    /** An offer as the admin sees it, with the coupon it advertises. */
    public record OfferView(UUID id, String title, String description, UUID couponId, String couponCode,
                            String couponStatus, String discountLabel, String appliesTo, String destinationCity,
                            Instant validFrom, Instant validTo, boolean seasonal, String theme, String status,
                            boolean live, boolean demo, Long version, Instant createdAt, Instant updatedAt) {
    }

    /** What the home page and the Offers page show. */
    public record PublicOfferView(UUID id, String title, String description, String couponCode, String discountLabel,
                                  BigDecimal minBookingAmount, String appliesTo, String destinationCity,
                                  Instant validTo, boolean seasonal, String theme, boolean demo) {
    }

    public record OfferRequest(
            @NotBlank @Size(min = 3, max = 80) String title,
            @Size(max = 300) String description,
            @NotNull UUID couponId,
            @Pattern(regexp = "ALL|FLIGHT|HOTEL") String appliesTo,
            @Size(max = 100) String destinationCity,
            @NotNull Instant validFrom,
            @NotNull Instant validTo,
            Boolean seasonal,
            @Pattern(regexp = "OCEAN|SUNSET|FOREST|CITY") String theme,
            @Pattern(regexp = "ACTIVE|INACTIVE") String status,
            Long version) {
    }
}
