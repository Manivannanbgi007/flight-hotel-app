package com.flighthotel.hotel.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.flighthotel.hotel.entity.DataSource;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.entity.PolicyType;
import com.flighthotel.hotel.entity.PropertyType;
import com.flighthotel.hotel.entity.SalesStatus;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Hotel manager API (/api/hotel-manager, API_DOCUMENTATION.md §6) and admin hotel API (§7). */
public final class ManagerDtos {

    private ManagerDtos() {
    }

    // ------------------------------------------------------------------ hotels

    public record HotelSummary(UUID id, String name, String slug, String city, String countryCode, HotelStatus status,
                               DataSource dataSource, Integer starRating, String imageUrl, long roomTypes,
                               long totalRooms, long managers, Instant updatedAt) {
    }

    public record HotelProfile(
            UUID id,
            String name,
            String slug,
            String description,
            PropertyType propertyType,
            Integer starRating,
            String addressLine,
            String city,
            String state,
            String countryCode,
            String postalCode,
            BigDecimal latitude,
            BigDecimal longitude,
            String timeZone,
            LocalTime checkInTime,
            LocalTime checkOutTime,
            String contactEmail,
            String contactPhone,
            Set<String> amenities,
            List<PolicyItem> policies,
            HotelStatus status,
            DataSource dataSource,
            List<ImageItem> images,
            long version) {
    }

    public record UpdateHotelProfileRequest(
            @NotBlank @Size(max = 150) String name,
            @Size(max = 5000) String description,
            @NotNull PropertyType propertyType,
            @Min(1) @Max(5) Integer starRating,
            @NotBlank @Size(max = 255) String addressLine,
            @NotBlank @Size(max = 100) String city,
            @Size(max = 100) String state,
            @NotBlank @Pattern(regexp = "^[A-Z]{2}$", message = "must be a 2-letter country code") String countryCode,
            @Size(max = 20) String postalCode,
            @DecimalMin("-90") @DecimalMax("90") BigDecimal latitude,
            @DecimalMin("-180") @DecimalMax("180") BigDecimal longitude,
            @NotNull LocalTime checkInTime,
            @NotNull LocalTime checkOutTime,
            @Email @Size(max = 254) String contactEmail,
            @Pattern(regexp = "^\\+?[0-9]{7,15}$", message = "must be 7-15 digits, optionally starting with +") String contactPhone,
            @NotNull @Size(max = 40) Set<String> amenities,
            @NotNull @Size(max = 20) List<@Valid PolicyItem> policies,
            @NotNull Long version) {
    }

    public record PolicyItem(@NotNull PolicyType type, @NotBlank @Size(max = 1000) String description) {
    }

    public record ImageItem(UUID id, String url, String thumbUrl, String caption, boolean cover, int sortOrder,
                            UUID roomTypeId, int width, int height) {
    }

    /** All fields optional: only the given ones change. */
    public record UpdateImageRequest(@Size(max = 200) String caption, Boolean cover, @Min(0) @Max(1000) Integer sortOrder,
                                     UUID roomTypeId, Boolean clearRoomType) {
    }

    // ------------------------------------------------------------------ rooms and prices

    public record RoomTypeItem(UUID id, String name, String description, int maxAdults, int maxChildren,
                               String bedConfiguration, Integer sizeSqm, int totalRooms, SalesStatus status,
                               int sortOrder, Set<String> amenities, List<RatePlanItem> ratePlans, long version) {
    }

    public record RoomTypeRequest(
            @NotBlank @Size(max = 100) String name,
            @Size(max = 2000) String description,
            @Min(1) @Max(10) int maxAdults,
            @Min(0) @Max(10) int maxChildren,
            @NotBlank @Size(max = 100) String bedConfiguration,
            @Min(1) @Max(10000) Integer sizeSqm,
            @Min(0) @Max(5000) int totalRooms,
            @NotNull SalesStatus status,
            @Min(0) @Max(1000) int sortOrder,
            @NotNull @Size(max = 40) Set<String> amenities,
            Long version) {
    }

    public record RatePlanItem(UUID id, UUID roomTypeId, String name, BigDecimal basePricePerNight, String currency,
                               boolean breakfastIncluded, boolean refundable, Integer freeCancellationHours,
                               BigDecimal cancellationFeePercent, String cancellationSummary, SalesStatus status,
                               List<SeasonalRateItem> seasonalRates, long version) {
    }

    /**
     * Refundable: free until {@code freeCancellationHours} before check-in, then {@code cancellationFeePercent} %.
     * Non-refundable: both ignored (100 % fee).
     */
    public record RatePlanRequest(
            @NotBlank @Size(max = 100) String name,
            @NotNull @DecimalMin("1.00") @Digits(integer = 10, fraction = 2) BigDecimal basePricePerNight,
            boolean breakfastIncluded,
            boolean refundable,
            @Min(0) @Max(720) Integer freeCancellationHours,
            @DecimalMin("0") @DecimalMax("100") @Digits(integer = 3, fraction = 2) BigDecimal cancellationFeePercent,
            @NotNull SalesStatus status,
            Long version) {
    }

    public record SeasonalRateItem(UUID id, String label, LocalDate startDate, LocalDate endDate,
                                   BigDecimal pricePerNight, int priority) {
    }

    public record SeasonalRateRequest(
            @NotBlank @Size(max = 80) String label,
            @NotNull LocalDate startDate,
            @NotNull LocalDate endDate,
            @NotNull @DecimalMin("1.00") @Digits(integer = 10, fraction = 2) BigDecimal pricePerNight,
            @Min(0) @Max(100) int priority) {
    }

    // ------------------------------------------------------------------ inventory calendar

    public record InventoryCalendar(LocalDate from, LocalDate to, LocalDate lastSellableNight,
                                    List<RoomTypeCalendar> roomTypes) {
    }

    public record RoomTypeCalendar(UUID roomTypeId, String name, int defaultTotalRooms, SalesStatus status,
                                   List<InventoryDay> days) {
    }

    /** @param price lowest price per night of the plans on sale that night (seasonal or base), null if none */
    public record InventoryDay(LocalDate date, int totalRooms, int bookedRooms, int heldRooms, int freeRooms,
                               boolean stopSell, BigDecimal price) {
    }

    /** Applies to every night from {@code from} to {@code to} (inclusive). Give totalRooms and/or stopSell. */
    public record UpdateInventoryRequest(
            @NotNull UUID roomTypeId,
            @NotNull LocalDate from,
            @NotNull LocalDate to,
            @Min(0) @Max(5000) Integer totalRooms,
            Boolean stopSell) {
    }

    // ------------------------------------------------------------------ admin

    public record CreateHotelRequest(
            @NotBlank @Size(max = 150) String name,
            @NotNull PropertyType propertyType,
            @NotBlank @Size(max = 255) String addressLine,
            @NotBlank @Size(max = 100) String city,
            @NotBlank @Pattern(regexp = "^[A-Z]{2}$", message = "must be a 2-letter country code") String countryCode,
            @Min(1) @Max(5) Integer starRating) {
    }

    public record ChangeHotelStatusRequest(@NotNull HotelStatus status) {
    }

    public record ManagerItem(UUID userId, String email, String firstName, String lastName, Instant assignedAt) {
    }

    public record AssignManagerRequest(@NotBlank @Email @Size(max = 254) String email) {
    }
}
