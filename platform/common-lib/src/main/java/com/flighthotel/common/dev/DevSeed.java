package com.flighthotel.common.dev;

import org.slf4j.Logger;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

/**
 * <b>Development only.</b> The last safety check of every development seeder. The seeders are already switched off by
 * {@code <service>.dev-seed.enabled} (environment variable {@code DEV_SEED_ENABLED}, default {@code false}, forced to
 * {@code false} in the {@code prod} profile by each service's {@code application.yml}). This check is the second lock:
 * even when someone sets the switch to {@code true} in production, nothing is written.
 */
public final class DevSeed {

    /** The one password of every seeded account. A development value, documented, never a secret. */
    public static final String PASSWORD = "DevTest@2026!";

    private DevSeed() {
    }

    /** @return false (after logging an error) when the {@code prod} profile is active */
    public static boolean allowed(Environment environment, Logger log, String service) {
        if (environment.acceptsProfiles(Profiles.of("prod"))) {
            log.error("{}: the development seed is enabled but the prod profile is active; nothing is seeded. "
                    + "Set DEV_SEED_ENABLED=false.", service);
            return false;
        }
        return true;
    }
}
