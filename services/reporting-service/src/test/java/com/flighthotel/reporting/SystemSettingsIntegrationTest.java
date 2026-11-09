package com.flighthotel.reporting;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.events.settings.SystemSettingChanged;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/**
 * Runs the real service against MySQL (Testcontainers). Kafka listeners are switched off and Schema Registry is
 * mocked; the outbox rows are checked directly, because that is exactly what Debezium will publish.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://reporting-it"
})
@AutoConfigureMockMvc
@Testcontainers
class SystemSettingsIntegrationTest {

    @Container
    @ServiceConnection
    static MySQLContainer mysql = new MySQLContainer("mysql:8.4.13").withDatabaseName("reporting_db");

    @Autowired
    MockMvc mockMvc;

    @Autowired
    JdbcClient jdbcClient;

    @MockitoBean
    RealtimePublisher realtimePublisher;

    @Test
    void defaultsAreBroadcastOnStartup() {
        long unpublished = jdbcClient.sql("SELECT COUNT(*) FROM system_settings WHERE published_version < version")
                .query(Long.class).single();
        long outboxRows = jdbcClient.sql("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'settings'")
                .query(Long.class).single();

        assertThat(unpublished).isZero();
        assertThat(outboxRows).isGreaterThanOrEqualTo(12);
    }

    @Test
    void adminChangeIsSavedPublishedToOutboxAndSignalled() throws Exception {
        long version = currentVersion("booking.payment-window-minutes");

        mockMvc.perform(put("/api/admin/settings/booking.payment-window-minutes")
                        .with(admin())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"value\":\"20\",\"expectedVersion\":" + version + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.value").value("20"))
                .andExpect(jsonPath("$.version").value(version + 1));

        byte[] payload = jdbcClient.sql("""
                        SELECT payload FROM outbox_events
                        WHERE aggregate_type = 'settings' AND aggregate_id = 'booking.payment-window-minutes'
                        ORDER BY created_at DESC, id DESC LIMIT 1""")
                .query(byte[].class).single();
        SystemSettingChanged event = deserialize(payload);
        assertThat(event.getValue()).isEqualTo("20");
        assertThat(event.getVersion()).isEqualTo(version + 1);

        verify(realtimePublisher).publish(argThat(m -> m.type().equals("settings.changed")), any());
    }

    @Test
    void staleVersionIsRejected() throws Exception {
        long version = currentVersion("support.email");

        mockMvc.perform(put("/api/admin/settings/support.email").with(admin())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"value\":\"help@example.com\",\"expectedVersion\":" + (version - 1) + "}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SETTING_CHANGED_BY_SOMEONE_ELSE"));
    }

    @Test
    void valueMustMatchType() throws Exception {
        long version = currentVersion("booking.max-flight-passengers");

        mockMvc.perform(put("/api/admin/settings/booking.max-flight-passengers").with(admin())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"value\":\"many\",\"expectedVersion\":" + version + "}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_SETTING_VALUE"));
    }

    @Test
    void onlyAdminsCanManageSettings() throws Exception {
        mockMvc.perform(get("/api/admin/settings"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        mockMvc.perform(get("/api/admin/settings").with(user("CUSTOMER")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        mockMvc.perform(get("/api/admin/settings").with(admin()))
                .andExpect(status().isOk());
    }

    @Test
    void publicSettingsNeedNoLogin() throws Exception {
        mockMvc.perform(get("/api/public/settings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.key == 'site.name')]").exists())
                .andExpect(jsonPath("$[?(@.key == 'hotel.gst.rate-above-threshold')]").doesNotExist());
    }

    private long currentVersion(String key) {
        return jdbcClient.sql("SELECT version FROM system_settings WHERE setting_key = :key")
                .param("key", key).query(Long.class).single();
    }

    private static JwtRequestPostProcessor admin() {
        return user("ADMIN");
    }

    private static JwtRequestPostProcessor user(String role) {
        return jwt().jwt(token -> token.subject(UUID.randomUUID().toString()).claim("roles", List.of(role)))
                .authorities(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_" + role));
    }

    private static SystemSettingChanged deserialize(byte[] payload) {
        try (KafkaAvroDeserializer deserializer = new KafkaAvroDeserializer()) {
            deserializer.configure(Map.of("schema.registry.url", "mock://reporting-it", "specific.avro.reader", true),
                    false);
            return (SystemSettingChanged) deserializer.deserialize("settings.events", payload);
        }
    }
}
