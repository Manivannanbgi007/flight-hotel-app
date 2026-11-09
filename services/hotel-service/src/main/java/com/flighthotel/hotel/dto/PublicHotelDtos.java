package com.flighthotel.hotel.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.flighthotel.hotel.entity.PolicyType;
import com.flighthotel.hotel.entity.PropertyType;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Public hotel API: search, details, rooms, quotes (API_DOCUMENTATION.md §5). */
public final class PublicHotelDtos {

    private PublicHotelDtos() {
    }

    // ------------------------------------------------------------------ stay (shared by search, rooms, quote)

    /** Who stays and when. Validated by StayValidator (dates relative to today, ages vs. children). */
    public record Stay(
            @NotNull LocalDate checkIn,
            @NotNull LocalDate checkOut,
            @Min(1) @Max(8) int rooms,
            @Min(1) @Max(32) int adults,
            @Min(0) @Max(16) int children,
            @Size(max = 16) List<@NotNull @Min(0) @Max(17) Integer> childAges) {

        public int guests() {
            return adults + children;
        }
    }

    // ------------------------------------------------------------------ search

    public enum SearchSort { RECOMMENDED, PRICE_ASC, PRICE_DESC, RATING_DESC, STARS_DESC, DISTANCE_ASC }

    /**
     * @param minPrice / maxPrice per room per night, before taxes
     * @param availableOnly false = also list hotels with no free room for the dates (marked unavailable)
     */
    public record SearchCriteria(
            @NotNull @Size(min = 2, max = 100) String destination,
            @NotNull @Valid Stay stay,
            BigDecimal minPrice,
            BigDecimal maxPrice,
            Set<@Min(1) @Max(5) Integer> stars,
            BigDecimal minGuestRating,
            Set<String> amenities,
            Set<PropertyType> propertyTypes,
            boolean freeCancellation,
            boolean breakfastIncluded,
            @Min(1) @Max(100) Double maxDistanceKm,
            boolean availableOnly,
            SearchSort sort,
            @Min(0) int page,
            @Min(1) @Max(50) int size) {
    }

    public record SearchResponse(
            List<HotelCard> content,
            int page,
            int size,
            long totalElements,
            int totalPages,
            int nights,
            Destination destination,
            Facets facets) {
    }

    /** @param distanceFrom name of the reference point, e.g. "Goa city centre" (null when unknown) */
    public record Destination(String query, String city, String distanceFrom, Double latitude, Double longitude) {
    }

    /** Ranges and counts of the current results, for the filter panel. */
    public record Facets(BigDecimal minPrice, BigDecimal maxPrice, Map<Integer, Long> stars,
                         Map<String, Long> propertyTypes) {
    }

    /**
     * One search result.
     *
     * @param pricePerNight cheapest matching offer: average per room per night before taxes (null if unavailable)
     * @param totalPrice    that offer for the whole stay and all rooms, taxes included
     */
    public record HotelCard(
            UUID id,
            String slug,
            String name,
            PropertyType propertyType,
            Integer starRating,
            BigDecimal guestRating,
            int reviewCount,
            String addressLine,
            String city,
            String countryCode,
            Double latitude,
            Double longitude,
            String imageUrl,
            List<String> amenities,
            boolean available,
            int availableRoomTypes,
            String cheapestRoomType,
            BigDecimal pricePerNight,
            BigDecimal totalPrice,
            String currency,
            boolean freeCancellation,
            boolean breakfastIncluded,
            Double distanceKm,
            boolean demo) {
    }

    public record DestinationSuggestion(String city, String countryCode, long hotels) {
    }

    /**
     * Home page card.
     *
     * @param imageUrl  the cover photo (thumbnail, as on search cards)
     * @param priceFrom lowest base price per night of any plan on sale, before taxes (null if none is on sale)
     */
    public record RecommendedHotel(UUID id, String slug, String name, String city, Integer starRating,
                                   BigDecimal guestRating, int reviewCount, String imageUrl, BigDecimal priceFrom,
                                   boolean demo) {
    }

    public record AmenityResponse(String code, String name, String category) {
    }

    // ------------------------------------------------------------------ details

    public record HotelDetails(
            UUID id,
            String slug,
            String name,
            String description,
            PropertyType propertyType,
            Integer starRating,
            BigDecimal guestRating,
            int reviewCount,
            String addressLine,
            String city,
            String state,
            String countryCode,
            String postalCode,
            Double latitude,
            Double longitude,
            LocalTime checkInTime,
            LocalTime checkOutTime,
            String timeZone,
            List<AmenityResponse> amenities,
            List<PolicyResponse> policies,
            List<ImageResponse> images,
            List<RoomTypeSummary> roomTypes,
            List<LandmarkDistance> nearby,
            boolean demo) {
    }

    public record PolicyResponse(PolicyType type, String description) {
    }

    public record ImageResponse(UUID id, String url, String thumbUrl, String caption, UUID roomTypeId, int width,
                                int height) {
    }

    public record RoomTypeSummary(UUID id, String name, String description, int maxAdults, int maxChildren,
                                  String bedConfiguration, Integer sizeSqm, List<AmenityResponse> amenities,
                                  List<ImageResponse> images) {
    }

    public record LandmarkDistance(String name, String type, double distanceKm) {
    }

    // ------------------------------------------------------------------ rooms for a stay

    public record RoomsResponse(UUID hotelId, LocalDate checkIn, LocalDate checkOut, int nights, int rooms, int adults,
                                int children, List<RoomOffer> roomTypes) {
    }

    /**
     * @param fitsParty    can {@code rooms} rooms of this type sleep the party
     * @param freeRooms    rooms of this type free for every night of the stay
     * @param available    fits, enough free rooms and at least one plan on sale
     */
    public record RoomOffer(RoomTypeSummary roomType, boolean fitsParty, int freeRooms, boolean available,
                            List<RateOffer> rates) {
    }

    public record RateOffer(UUID ratePlanId, String name, boolean breakfastIncluded, boolean refundable,
                            boolean freeCancellation, Instant freeCancellationUntil, String cancellationPolicy,
                            BigDecimal pricePerNight, BigDecimal subtotal, BigDecimal taxes, BigDecimal total,
                            String currency, List<NightlyPrice> nights) {
    }

    public record NightlyPrice(LocalDate date, BigDecimal price, String season) {
    }

    // ------------------------------------------------------------------ quote

    public record QuoteRequest(
            @NotNull UUID hotelId,
            @NotNull UUID roomTypeId,
            @NotNull UUID ratePlanId,
            @NotNull @Valid Stay stay) {
    }

    /**
     * A price and availability check that booking-service will honour for 15 minutes (BOOKING_WORKFLOW.md §2).
     * Stored in Redis; nothing is reserved yet.
     */
    public record Quote(
            UUID quoteId,
            Instant createdAt,
            Instant expiresAt,
            UUID hotelId,
            String hotelSlug,
            String hotelName,
            String hotelAddress,
            LocalTime checkInTime,
            LocalTime checkOutTime,
            UUID roomTypeId,
            String roomTypeName,
            UUID ratePlanId,
            String ratePlanName,
            boolean breakfastIncluded,
            LocalDate checkIn,
            LocalDate checkOut,
            int nights,
            int rooms,
            int adults,
            int children,
            List<Integer> childAges,
            List<NightlyPrice> nightlyPrices,
            BigDecimal subtotal,
            BigDecimal taxes,
            List<TaxLine> taxLines,
            BigDecimal total,
            String currency,
            boolean refundable,
            boolean freeCancellation,
            Instant freeCancellationUntil,
            BigDecimal cancellationFeePercent,
            String cancellationPolicy,
            boolean demo) {
    }

    /** GST per rate (5 % / 18 % slabs, System Settings). */
    public record TaxLine(String label, BigDecimal ratePercent, BigDecimal amount) {
    }
}
