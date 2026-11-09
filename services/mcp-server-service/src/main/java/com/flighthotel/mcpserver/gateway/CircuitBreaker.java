package com.flighthotel.mcpserver.gateway;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

/**
 * A small circuit breaker for one downstream area (for example {@code /api/bookings}): after
 * {@code failureThreshold} consecutive failures (timeouts, 5xx) calls fail fast for {@code openFor}; then one trial
 * call is let through. A success closes it again. Thread-safe; one instance per area.
 */
public class CircuitBreaker {

    public enum State { CLOSED, OPEN, HALF_OPEN }

    private final int failureThreshold;
    private final Duration openFor;
    private final Clock clock;

    private State state = State.CLOSED;
    private int consecutiveFailures;
    private Instant openedAt;
    private boolean trialInFlight;

    public CircuitBreaker(int failureThreshold, Duration openFor, Clock clock) {
        this.failureThreshold = Math.max(1, failureThreshold);
        this.openFor = openFor;
        this.clock = clock;
    }

    /** @return true if the call may go ahead */
    public synchronized boolean tryAcquire() {
        if (state == State.CLOSED) {
            return true;
        }
        if (state == State.OPEN && !clock.instant().isBefore(openedAt.plus(openFor))) {
            state = State.HALF_OPEN;
            trialInFlight = false;
        }
        if (state == State.HALF_OPEN && !trialInFlight) {
            trialInFlight = true;
            return true;
        }
        return false;
    }

    public synchronized void onSuccess() {
        state = State.CLOSED;
        consecutiveFailures = 0;
        trialInFlight = false;
    }

    public synchronized void onFailure() {
        consecutiveFailures++;
        if (state == State.HALF_OPEN || consecutiveFailures >= failureThreshold) {
            state = State.OPEN;
            openedAt = clock.instant();
            trialInFlight = false;
        }
    }

    public synchronized State state() {
        return state;
    }
}
