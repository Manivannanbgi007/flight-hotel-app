package com.flighthotel.search.query;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.flighthotel.search.config.SearchProperties;
import com.flighthotel.search.query.Viewer.ManagedHotel;

/**
 * Which hotels a hotel manager runs. hotel-service owns that list ({@code hotel_staff}) and publishes no event for it,
 * so it is asked with the manager's <b>own</b> access token ({@code GET /api/hotel-manager/hotels}): hotel-service
 * applies its own rules and answers only the manager's hotels. The answer is reused for a minute.
 * <p>
 * If hotel-service does not answer, the manager gets no hotel results at all (fail closed), never somebody else's.
 */
@Component
public class ManagedHotelsClient {

    private static final Logger log = LoggerFactory.getLogger(ManagedHotelsClient.class);

    private final RestClient hotelService;
    private final Duration cacheFor;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    public ManagedHotelsClient(SearchProperties properties) {
        SimpleClientHttpRequestFactory timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(2));
        timeouts.setReadTimeout(Duration.ofSeconds(3));
        this.hotelService = RestClient.builder().baseUrl(properties.hotelServiceUrl()).requestFactory(timeouts).build();
        this.cacheFor = properties.managedHotelsCacheTtl();
    }

    private record Cached(List<ManagedHotel> hotels, Instant until) {
    }

    public List<ManagedHotel> hotelsOf(String userId, String accessToken) {
        Cached cached = cache.get(userId);
        if (cached != null && cached.until().isAfter(Instant.now())) {
            return cached.hotels();
        }
        try {
            List<Map<String, Object>> answer = hotelService.get().uri("/api/hotel-manager/hotels")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                    .retrieve()
                    .body(new ParameterizedTypeReference<>() {
                    });
            List<ManagedHotel> hotels = answer == null ? List.of() : answer.stream()
                    .map(hotel -> new ManagedHotel(String.valueOf(hotel.get("id")),
                            Objects.toString(hotel.get("name"), ""), Objects.toString(hotel.get("city"), "")))
                    .toList();
            cache.put(userId, new Cached(hotels, Instant.now().plus(cacheFor)));
            return hotels;
        } catch (RestClientException ex) {
            log.warn("Could not read the hotels of manager {}; showing no hotel results: {}", userId, ex.toString());
            return List.of();
        }
    }
}
