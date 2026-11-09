package com.flighthotel.reporting.facts;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.Roles;

/**
 * Tells open admin dashboards to reload ({@code dashboard.updated}) when facts changed, at most once per interval: a
 * busy hour or a replay of the topics sends one message per interval, not one per event.
 */
@Component
public class DashboardUpdates {

    private final AtomicBoolean dirty = new AtomicBoolean();
    private final RealtimePublisher realtime;

    public DashboardUpdates(RealtimePublisher realtime) {
        this.realtime = realtime;
    }

    void changed() {
        dirty.set(true);
    }

    @Scheduled(fixedDelayString = "${reporting.dashboard-update-interval:10s}")
    public void publishIfChanged() {
        if (dirty.getAndSet(false)) {
            realtime.publish(RealtimeMessage.of("dashboard.updated", "DASHBOARD", "admin", Map.of()),
                    RealtimeAudience.roles(Roles.ADMIN));
        }
    }
}
