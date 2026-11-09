package com.flighthotel.flight.service;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.Roles;
import com.flighthotel.flight.entity.FlightProviderEntity;
import com.flighthotel.flight.integration.FlightProviders.FlightBookingProvider;
import com.flighthotel.flight.repository.FlightProviderRepository;

/** Flight Provider Management (admin): enable/disable, priority and health of each flight provider. */
@Service
public class FlightProviderService {

    public record ProviderView(String code, String name, boolean enabled, boolean demo, int priority, int timeoutMs,
            String healthStatus, Instant healthCheckedAt, String lastError) {
        static ProviderView of(FlightProviderEntity p) {
            return new ProviderView(p.getCode(), p.getName(), p.isEnabled(), p.isDemo(), p.getPriority(),
                    p.getTimeoutMs(), p.getHealthStatus(), p.getHealthCheckedAt(), p.getLastError());
        }
    }

    private final FlightProviderRepository providers;
    private final Map<String, FlightBookingProvider> adapters;
    private final RealtimePublisher realtime;
    private final Clock clock;

    public FlightProviderService(FlightProviderRepository providers, ProviderRegistry registry,
            RealtimePublisher realtime, Clock clock) {
        this.providers = providers;
        this.adapters = registry.bookingProviders();
        this.realtime = realtime;
        this.clock = clock;
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public List<ProviderView> list() {
        return providers.findAllByOrderByPriorityAsc().stream().map(ProviderView::of).toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ProviderView update(String code, Boolean enabled, Integer priority) {
        FlightProviderEntity provider = find(code);
        provider.update(enabled, priority);
        signal(provider);
        return ProviderView.of(provider);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ProviderView healthCheck(String code) {
        return ProviderView.of(check(find(code)));
    }

    /** The scheduled health check (no user): every provider, every minute. */
    @Transactional
    public void checkAll() {
        providers.findAll().forEach(this::check);
    }

    private FlightProviderEntity check(FlightProviderEntity provider) {
        FlightBookingProvider adapter = adapters.get(provider.getCode());
        String status = "UP";
        String error = null;
        if (adapter == null) {
            status = "DOWN";
            error = "No adapter for this provider";
        } else {
            try {
                adapter.checkHealth();
            } catch (RuntimeException ex) {
                status = "DOWN";
                error = ex.getMessage();
            }
        }
        if (provider.health(status, error, clock.instant())) {
            signal(provider);
        }
        return provider;
    }

    private FlightProviderEntity find(String code) {
        return providers.findByCode(code.toUpperCase()).orElseThrow(() ->
                new ResourceNotFoundException("Flight provider", code));
    }

    private void signal(FlightProviderEntity provider) {
        realtime.publish(RealtimeMessage.of("flight.provider-health-changed", "FLIGHT_PROVIDER", provider.getCode(),
                Map.of("healthStatus", provider.getHealthStatus(), "enabled", provider.isEnabled())),
                RealtimeAudience.roles(Roles.ADMIN));
    }
}
