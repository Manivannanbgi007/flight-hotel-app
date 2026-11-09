package com.flighthotel.reporting;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.events.audit.AuditEventRecorded;
import com.flighthotel.reporting.audit.AuditEventsListener;

/**
 * Phase 7: the audit trail. Audit events of every service are stored once each and admins can search them
 * (API_DOCUMENTATION.md section 11).
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://reporting-audit-it"
})
@AutoConfigureMockMvc
@Testcontainers
class AuditLogIntegrationTest {

    @Container
    @ServiceConnection
    static MySQLContainer mysql = new MySQLContainer("mysql:8.4.13").withDatabaseName("reporting_db");

    @Autowired
    MockMvc mockMvc;

    @Autowired
    AuditEventsListener listener;

    @MockitoBean
    RealtimePublisher realtimePublisher;

    @Test
    void auditEventsAreStoredOnceAndAdminsCanSearchThem() throws Exception {
        String bookingId = UUID.randomUUID().toString();
        String agent = UUID.randomUUID().toString();
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        String requested = UUID.randomUUID().toString();

        listener.handle(requested, event("booking-service", "BOOKING_CANCELLATION_REQUESTED", bookingId, agent,
                List.of("SUPPORT_AGENT"), Map.of("initiatedBy", "SUPPORT_AGENT", "quotedRefund", "3150.00"),
                now.minusSeconds(60)));
        // Redelivered by Kafka: stored once.
        listener.handle(requested, event("booking-service", "BOOKING_CANCELLATION_REQUESTED", bookingId, agent,
                List.of("SUPPORT_AGENT"), Map.of("initiatedBy", "SUPPORT_AGENT", "quotedRefund", "3150.00"),
                now.minusSeconds(60)));
        listener.handle(UUID.randomUUID().toString(), event("booking-service", "BOOKING_CANCELLED", bookingId,
                "SYSTEM", List.of(), Map.of("refundAmount", "3150.00"), now));
        listener.handle(UUID.randomUUID().toString(), event("payment-service", "REFUND_STARTED",
                UUID.randomUUID().toString(), "SYSTEM", List.of(), Map.of("bookingId", bookingId), now));

        mockMvc.perform(get("/api/admin/audit-logs?entityType=BOOKING&entityId=" + bookingId).with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].action").value("BOOKING_CANCELLED"))
                .andExpect(jsonPath("$.content[1].action").value("BOOKING_CANCELLATION_REQUESTED"))
                .andExpect(jsonPath("$.content[1].actorId").value(agent))
                .andExpect(jsonPath("$.content[1].actorRoles[0]").value("SUPPORT_AGENT"))
                .andExpect(jsonPath("$.content[1].details.quotedRefund").value("3150.00"))
                .andExpect(jsonPath("$.content[1].service").value("booking-service"))
                .andExpect(jsonPath("$.content[1].occurredAt").value(now.minusSeconds(60).toString()));
        mockMvc.perform(get("/api/admin/audit-logs?action=REFUND_STARTED&from=" + now.minusSeconds(5) + "&to="
                        + now.plusSeconds(5)).with(admin()))
                .andExpect(jsonPath("$.content[*].details.bookingId").value(Matchers.hasItem(bookingId)));
        mockMvc.perform(get("/api/admin/audit-logs?actorId=" + agent + "&size=1").with(admin()))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.totalPages").value(1));

        mockMvc.perform(get("/api/admin/audit-logs").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_SUPPORT_AGENT"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/admin/audit-logs")).andExpect(status().isUnauthorized());
    }

    private static AuditEventRecorded event(String service, String action, String entityId, String actor,
            List<String> roles, Map<String, String> details, Instant at) {
        return AuditEventRecorded.newBuilder().setService(service).setAction(action)
                .setEntityType(action.startsWith("REFUND") ? "REFUND" : "BOOKING").setEntityId(entityId)
                .setActorId(actor).setActorRoles(roles).setDetails(details).setIpAddress("203.0.113.7")
                .setCorrelationId(UUID.randomUUID().toString()).setOccurredAt(at).build();
    }

    private static JwtRequestPostProcessor admin() {
        return jwt().jwt(token -> token.subject(UUID.randomUUID().toString()).claim("roles", List.of("ADMIN")))
                .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
    }
}
