package com.flighthotel.common.settings;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.flighthotel.events.settings.SystemSettingChanged;

/**
 * Read-only, in-memory copy of the system settings owned by reporting-service.
 * <p>
 * Every service reads the compacted topic {@code settings.events} from the beginning at startup and then keeps
 * listening, so an admin change reaches all services within seconds without restarts. Always pass a sensible
 * default: the service must work even before the first setting arrives.
 */
public class SystemSettings {

    private static final Logger log = LoggerFactory.getLogger(SystemSettings.class);

    private final Map<String, String> values = new ConcurrentHashMap<>();
    private final Map<String, Long> versions = new ConcurrentHashMap<>();

    /** Applies a change. Older versions (e.g. replayed out of order) are ignored. */
    public void apply(SystemSettingChanged change) {
        versions.compute(change.getKey(), (key, currentVersion) -> {
            if (currentVersion != null && currentVersion > change.getVersion()) {
                return currentVersion;
            }
            if (change.getValue() == null) {
                values.remove(key);
            } else {
                values.put(key, change.getValue());
            }
            log.info("System setting updated: key={} version={}", key, change.getVersion());
            return change.getVersion();
        });
    }

    public Optional<String> get(String key) {
        return Optional.ofNullable(values.get(key));
    }

    public String getString(String key, String defaultValue) {
        return values.getOrDefault(key, defaultValue);
    }

    public int getInt(String key, int defaultValue) {
        return parse(key, defaultValue, Integer::valueOf);
    }

    public boolean getBoolean(String key, boolean defaultValue) {
        return parse(key, defaultValue, Boolean::valueOf);
    }

    public BigDecimal getDecimal(String key, BigDecimal defaultValue) {
        return parse(key, defaultValue, BigDecimal::new);
    }

    /** Durations use ISO-8601 (e.g. {@code PT15M}) or plain minutes (e.g. {@code 15}). */
    public Duration getDuration(String key, Duration defaultValue) {
        return parse(key, defaultValue, v -> v.startsWith("P") ? Duration.parse(v) : Duration.ofMinutes(Long.parseLong(v)));
    }

    public Map<String, String> snapshot() {
        return Map.copyOf(values);
    }

    private <T> T parse(String key, T defaultValue, java.util.function.Function<String, T> parser) {
        String raw = values.get(key);
        if (raw == null) {
            return defaultValue;
        }
        try {
            return parser.apply(raw.trim());
        } catch (RuntimeException ex) {
            log.warn("Invalid value for system setting {}; using default", key);
            return defaultValue;
        }
    }
}
