package com.flighthotel.flight.service;

import java.util.Optional;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import com.flighthotel.flight.config.FlightProperties;
import com.flighthotel.flight.dto.FlightDtos.StoredTrip;
import com.flighthotel.flight.integration.FlightModel.StoredOption;

import tools.jackson.databind.json.JsonMapper;

/**
 * Search results and revalidated trips live in Redis for 20 minutes ({@code flight:option:{id}},
 * {@code flight:trip:{id}}): a customer who waits longer must search again.
 */
@Component
public class OfferStore {

    private final StringRedisTemplate redis;
    private final JsonMapper json;
    private final FlightProperties properties;

    public OfferStore(StringRedisTemplate redis, JsonMapper json, FlightProperties properties) {
        this.redis = redis;
        this.json = json;
        this.properties = properties;
    }

    public void saveOption(StoredOption option) {
        redis.opsForValue().set("flight:option:" + option.option().offerId(), json.writeValueAsString(option),
                properties.offerTtl());
    }

    public Optional<StoredOption> findOption(String offerId) {
        return Optional.ofNullable(redis.opsForValue().get("flight:option:" + offerId))
                .map(text -> json.readValue(text, StoredOption.class));
    }

    public void saveTrip(StoredTrip trip) {
        redis.opsForValue().set("flight:trip:" + trip.offer().tripOfferId(), json.writeValueAsString(trip),
                properties.offerTtl());
    }

    public Optional<StoredTrip> findTrip(String tripOfferId) {
        return Optional.ofNullable(redis.opsForValue().get("flight:trip:" + tripOfferId))
                .map(text -> json.readValue(text, StoredTrip.class));
    }
}
