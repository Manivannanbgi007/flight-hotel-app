package com.flighthotel.hotel.search;

import java.util.List;

/**
 * One hotel in the Elasticsearch index {@code hotels} (CQRS read side, DATABASE_DESIGN.md §3). Only data that does
 * not depend on dates; availability and prices for a stay are always computed from MySQL.
 *
 * @param maxGuestsPerRoom largest (adults + children) any room type on sale can take
 * @param minBasePrice     lowest base price per night of any plan on sale (sorting/teasers only)
 */
public record HotelDocument(
        String id,
        String slug,
        String name,
        String city,
        String state,
        String countryCode,
        String address,
        GeoLocation location,
        Integer starRating,
        Double guestRating,
        int reviewCount,
        String propertyType,
        List<String> amenities,
        boolean freeCancellation,
        boolean breakfast,
        int maxGuestsPerRoom,
        Double minBasePrice,
        String coverImageId,
        String dataSource) {

    public record GeoLocation(double lat, double lon) {
    }
}
