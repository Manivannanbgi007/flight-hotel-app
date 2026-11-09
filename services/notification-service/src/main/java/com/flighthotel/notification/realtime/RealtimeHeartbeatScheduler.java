package com.flighthotel.notification.realtime;

import org.springframework.scheduling.annotation.Scheduled;

/** Every {@code notification.realtime.heartbeat-interval}: ping open streams and close expired ones. */
public class RealtimeHeartbeatScheduler {

    private final RealtimeHub hub;

    public RealtimeHeartbeatScheduler(RealtimeHub hub) {
        this.hub = hub;
    }

    @Scheduled(fixedDelayString = "${notification.realtime.heartbeat-interval:25s}",
            initialDelayString = "${notification.realtime.heartbeat-interval:25s}")
    public void heartbeat() {
        hub.heartbeat();
    }
}
