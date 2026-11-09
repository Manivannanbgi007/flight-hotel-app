package com.flighthotel.identity.scheduler;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.identity.config.IdentityProperties;
import com.flighthotel.identity.repository.EmailVerificationTokenRepository;
import com.flighthotel.identity.repository.LoginHistoryRepository;
import com.flighthotel.identity.repository.PasswordResetTokenRepository;
import com.flighthotel.identity.repository.RefreshTokenRepository;

/**
 * Daily cleanup: expired tokens and old login history. Safe to run on several instances at once (plain deletes).
 * Expired tokens are kept one extra day so a "this link has expired" or "session expired" decision can still be
 * investigated from the database for a while.
 */
@Component
public class IdentityHousekeepingJob {

    private static final Logger log = LoggerFactory.getLogger(IdentityHousekeepingJob.class);
    private static final Duration EXPIRED_TOKEN_GRACE = Duration.ofDays(1);

    private final RefreshTokenRepository refreshTokens;
    private final EmailVerificationTokenRepository verificationTokens;
    private final PasswordResetTokenRepository resetTokens;
    private final LoginHistoryRepository loginHistory;
    private final IdentityProperties properties;
    private final Clock clock;

    public IdentityHousekeepingJob(RefreshTokenRepository refreshTokens,
            EmailVerificationTokenRepository verificationTokens, PasswordResetTokenRepository resetTokens,
            LoginHistoryRepository loginHistory, IdentityProperties properties, Clock clock) {
        this.refreshTokens = refreshTokens;
        this.verificationTokens = verificationTokens;
        this.resetTokens = resetTokens;
        this.loginHistory = loginHistory;
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(cron = "${identity.housekeeping.cron:0 15 3 * * *}")
    @Transactional
    public void cleanUp() {
        Instant now = clock.instant();
        Instant tokenCutoff = now.minus(EXPIRED_TOKEN_GRACE);
        int refresh = refreshTokens.deleteExpiredBefore(tokenCutoff);
        int verification = verificationTokens.deleteExpiredBefore(tokenCutoff);
        int reset = resetTokens.deleteExpiredBefore(tokenCutoff);
        int history = loginHistory.deleteOlderThan(now.minus(properties.retention().loginHistory()));
        log.info("Identity housekeeping: refreshTokens={} verificationTokens={} resetTokens={} loginHistory={}",
                refresh, verification, reset, history);
    }
}
