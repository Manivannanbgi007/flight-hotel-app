package com.flighthotel.flight.service;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.flight.entity.FlightProviderEntity;
import com.flighthotel.flight.integration.FlightProviders.FlightBookingProvider;
import com.flighthotel.flight.integration.FlightProviders.FlightSearchProvider;
import com.flighthotel.flight.integration.demo.DemoFlightProvider;
import com.flighthotel.flight.repository.FlightProviderRepository;

/**
 * Which provider answers a search (the enabled, not DOWN one with the best priority) and which one handles a booking
 * (always the one that held it, even if it was disabled meanwhile). Only DEMO exists today; a real supplier adapter is
 * added to the maps below and to {@code flight_providers} (SUPPLIER_INTEGRATION.md section 5).
 */
@Component
public class ProviderRegistry {

    private final FlightProviderRepository providers;
    private final Map<String, FlightSearchProvider> searchProviders;
    private final Map<String, FlightBookingProvider> bookingProviders;

    public ProviderRegistry(FlightProviderRepository providers, DemoFlightProvider demo) {
        this.providers = providers;
        this.searchProviders = Map.of(DemoFlightProvider.CODE, demo);
        this.bookingProviders = Map.of(DemoFlightProvider.CODE, demo);
    }

    /** The provider for new searches; never stale data: with none available the search is "temporarily unavailable". */
    public FlightSearchProvider forSearch() {
        List<FlightProviderEntity> candidates = providers.findAllByOrderByPriorityAsc();
        return candidates.stream()
                .filter(FlightProviderEntity::isEnabled)
                .filter(entity -> !"DOWN".equals(entity.getHealthStatus()))
                .map(entity -> searchProviders.get(entity.getCode()))
                .filter(java.util.Objects::nonNull)
                .findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "FLIGHT_SEARCH_UNAVAILABLE",
                        "Flight search is temporarily unavailable. Please try again in a few minutes."));
    }

    public FlightSearchProvider searchProvider(String code) {
        FlightSearchProvider provider = searchProviders.get(code);
        if (provider == null) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "FLIGHT_SEARCH_UNAVAILABLE",
                    "Flight search is temporarily unavailable. Please try again in a few minutes.");
        }
        return provider;
    }

    public FlightBookingProvider bookingProvider(String code) {
        FlightBookingProvider provider = bookingProviders.get(code);
        if (provider == null) {
            throw new IllegalStateException("No flight booking provider " + code);
        }
        return provider;
    }

    public Map<String, FlightBookingProvider> bookingProviders() {
        return bookingProviders;
    }
}
