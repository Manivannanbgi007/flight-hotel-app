package com.flighthotel.flight.entity;

import java.time.Instant;
import java.util.UUID;

import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** A flight provider as managed in the admin portal (SUPPLIER_INTEGRATION.md section 2). */
@Getter
@Entity
@Table(name = "flight_providers")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class FlightProviderEntity extends AuditableEntity {

    @Id
    private UUID id;

    @Column(nullable = false, updatable = false, length = 20)
    private String code;

    @Column(nullable = false, length = 80)
    private String name;

    @Column(nullable = false)
    private boolean enabled;

    @Column(name = "is_demo", nullable = false, updatable = false)
    private boolean demo;

    @Column(nullable = false)
    private int priority;

    @Column(name = "timeout_ms", nullable = false)
    private int timeoutMs;

    @Column(name = "health_status", nullable = false, length = 10)
    private String healthStatus;

    @Column(name = "health_checked_at")
    private Instant healthCheckedAt;

    @Column(name = "last_error", length = 255)
    private String lastError;

    @Version
    private Long version;

    public void update(Boolean enabled, Integer priority) {
        if (enabled != null) {
            this.enabled = enabled;
        }
        if (priority != null) {
            this.priority = priority;
        }
    }

    /** @return true when the status changed */
    public boolean health(String status, String error, Instant now) {
        boolean changed = !status.equals(healthStatus);
        this.healthStatus = status;
        this.lastError = error == null ? null : error.substring(0, Math.min(255, error.length()));
        this.healthCheckedAt = now;
        return changed;
    }
}
