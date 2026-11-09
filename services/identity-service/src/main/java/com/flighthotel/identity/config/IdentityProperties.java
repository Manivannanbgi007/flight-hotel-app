package com.flighthotel.identity.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** identity-service settings ({@code identity.*} in application.yml). */
@ConfigurationProperties("identity")
public record IdentityProperties(
        @DefaultValue Tokens tokens,
        @DefaultValue Cookie cookie,
        @DefaultValue Login login,
        @DefaultValue Retention retention,
        @DefaultValue Photo photo,
        @DefaultValue DemoUsers demoUsers) {

    public record Tokens(
            @DefaultValue("15m") Duration accessTokenTtl,
            @DefaultValue("1d") Duration refreshTokenTtl,
            @DefaultValue("30d") Duration rememberMeTtl,
            @DefaultValue("30s") Duration refreshReuseGrace,
            @DefaultValue("24h") Duration emailVerificationTtl,
            @DefaultValue("1h") Duration passwordResetTtl,
            @DefaultValue("72h") Duration invitationTtl,
            @DefaultValue("60s") Duration emailResendInterval) {
    }

    public record Cookie(@DefaultValue("fh_refresh") String name, @DefaultValue("true") boolean secure) {
    }

    public record Login(@DefaultValue("5") int maxFailedAttempts, @DefaultValue("15m") Duration lockoutDuration) {
    }

    public record Retention(@DefaultValue("180d") Duration loginHistory) {
    }

    public record Photo(@DefaultValue("2097152") int maxBytes, @DefaultValue("512") int maxDimension) {
    }

    public record DemoUsers(@DefaultValue("false") boolean enabled, String password) {
    }
}
