package com.flighthotel.search.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Settings of the search service ({@code search.*} in application.yml).
 *
 * @param indexAlias            the alias all reads and writes use; it points to the versioned index
 * @param hotelsIndex           hotel-service's index of active hotels (read only here)
 * @param queryTimeout          how long Elasticsearch may spend on one search
 * @param hotelServiceUrl       where to ask which hotels a hotel manager runs
 * @param managedHotelsCacheTtl how long that answer is reused
 * @param flightServiceUrl      where the public airport list comes from (destinations)
 * @param destinationsRefresh   how often the destinations are rebuilt
 */
@ConfigurationProperties("search")
public record SearchProperties(
        @DefaultValue("global-search") String indexAlias,
        @DefaultValue("hotels") String hotelsIndex,
        @DefaultValue("2s") Duration queryTimeout,
        @DefaultValue("http://localhost:8102") String hotelServiceUrl,
        @DefaultValue("60s") Duration managedHotelsCacheTtl,
        @DefaultValue("http://localhost:8103") String flightServiceUrl,
        @DefaultValue("10m") Duration destinationsRefresh) {
}
