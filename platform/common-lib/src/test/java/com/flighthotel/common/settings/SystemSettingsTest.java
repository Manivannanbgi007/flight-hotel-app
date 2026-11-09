package com.flighthotel.common.settings;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.Test;

import com.flighthotel.events.settings.SystemSettingChanged;

class SystemSettingsTest {

    private final SystemSettings settings = new SystemSettings();

    @Test
    void returnsDefaultUntilASettingArrives() {
        assertThat(settings.getInt("booking.hold-minutes", 15)).isEqualTo(15);

        settings.apply(change("booking.hold-minutes", "20", 1));

        assertThat(settings.getInt("booking.hold-minutes", 15)).isEqualTo(20);
    }

    @Test
    void ignoresOlderVersions() {
        settings.apply(change("support.email", "new@example.com", 5));
        settings.apply(change("support.email", "old@example.com", 4));

        assertThat(settings.getString("support.email", null)).isEqualTo("new@example.com");
    }

    @Test
    void removesASettingWhenValueIsNull() {
        settings.apply(change("feature.x", "true", 1));
        settings.apply(change("feature.x", null, 2));

        assertThat(settings.get("feature.x")).isEmpty();
    }

    @Test
    void parsesDurationsAndFallsBackOnInvalidValues() {
        settings.apply(change("a", "PT10M", 1));
        settings.apply(change("b", "25", 1));
        settings.apply(change("c", "not-a-number", 1));

        assertThat(settings.getDuration("a", Duration.ZERO)).isEqualTo(Duration.ofMinutes(10));
        assertThat(settings.getDuration("b", Duration.ZERO)).isEqualTo(Duration.ofMinutes(25));
        assertThat(settings.getInt("c", 7)).isEqualTo(7);
    }

    private static SystemSettingChanged change(String key, String value, long version) {
        return SystemSettingChanged.newBuilder()
                .setKey(key).setValue(value).setValueType("STRING").setVersion(version)
                .setChangedBy("SYSTEM").setChangedAt(Instant.now())
                .build();
    }
}
