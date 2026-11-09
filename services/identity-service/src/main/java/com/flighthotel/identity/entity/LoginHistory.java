package com.flighthotel.identity.entity;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import com.flighthotel.common.id.UuidV7;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** One login attempt on a known account (shown to the user under Security, kept 180 days). */
@Getter
@Entity
@Table(name = "login_history")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LoginHistory {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private boolean success;

    @Column(name = "failure_reason", length = 40)
    private String failureReason;

    @Column(name = "ip_address", length = 45)
    private String ipAddress;

    @Column(name = "user_agent")
    private String userAgent;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    public LoginHistory(UUID userId, boolean success, String failureReason, String ipAddress, String userAgent,
            Instant occurredAt) {
        this.id = UuidV7.generate();
        this.userId = userId;
        this.success = success;
        this.failureReason = failureReason;
        this.ipAddress = ipAddress;
        this.userAgent = userAgent;
        this.occurredAt = occurredAt;
    }
}
