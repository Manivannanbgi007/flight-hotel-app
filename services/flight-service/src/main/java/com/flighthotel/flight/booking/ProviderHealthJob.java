package com.flighthotel.flight.booking;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.flighthotel.flight.service.FlightProviderService;

/** Updates the health of every flight provider (visible in Flight Provider Management). */
@Component
public class ProviderHealthJob {

    private final FlightProviderService providers;

    public ProviderHealthJob(FlightProviderService providers) {
        this.providers = providers;
    }

    @Scheduled(fixedDelayString = "${flight.jobs.health-interval:60s}", initialDelayString = "PT10S")
    public void check() {
        providers.checkAll();
    }
}
