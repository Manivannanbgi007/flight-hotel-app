package com.flighthotel.reporting;

import static com.flighthotel.testsupport.RoleTokens.CUSTOMER;
import static com.flighthotel.testsupport.RoleTokens.HOTEL_MANAGER;
import static com.flighthotel.testsupport.RoleTokens.SUPPORT_AGENT;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.testsupport.AccessMatrix;
import com.flighthotel.testsupport.Endpoints;

/**
 * Who may call what (SECURITY_GUIDE.md): the home page figures and public settings need no login; dashboards and
 * reports need REPORT_VIEW, the audit log and the system settings are for admins only. Requests are valid, so a
 * refusal proves the permission check and not request validation.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://reporting-security-it"
})
@AutoConfigureMockMvc
@Testcontainers
class EndpointSecurityTest {

    private static final Set<String> PUBLIC = Set.of(
            "GET /api/public/popular-destinations",
            "GET /api/public/popular-routes",
            "GET /api/public/settings",
            // A one-time link: the token in it is the permission (AuditExportIntegrationTest).
            "GET /api/public/export-files/{id}");

    private static final String[] NOT_ADMINS = {CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT};

    @Container
    @ServiceConnection
    static MySQLContainer mysql = new MySQLContainer("mysql:8.4.13").withDatabaseName("reporting_db");

    @MockitoBean
    RealtimePublisher realtimePublisher;

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ApplicationContext context;

    @Test
    void everyEndpointExceptThePublicOnesNeedsALogin() throws Exception {
        AccessMatrix.everyEndpointNeedsALoginExcept(mockMvc, Endpoints.of(context), PUBLIC);
    }

    @Test
    void reportsAuditLogsAndSettingsAreForAdmins() throws Exception {
        AccessMatrix matrix = new AccessMatrix()
                .refuse("GET /api/admin/dashboard", () -> get("/api/admin/dashboard?range=THIS_YEAR&interval=MONTH"),
                        NOT_ADMINS)
                .refuse("GET /api/admin/reports/{report}", () -> get("/api/admin/reports/revenue?range=LAST_7_DAYS"),
                        NOT_ADMINS)
                .refuse("GET /api/admin/reports/{report}/export",
                        () -> get("/api/admin/reports/customers/export?format=csv&range=LAST_7_DAYS"), NOT_ADMINS)
                .refuse("GET /api/admin/audit-logs", () -> get("/api/admin/audit-logs"), NOT_ADMINS)
                .refuse("POST /api/admin/audit-logs/exports", () -> post("/api/admin/audit-logs/exports")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"format\":\"XLSX\"}"), NOT_ADMINS)
                .refuse("GET /api/admin/audit-logs/exports", () -> get("/api/admin/audit-logs/exports"), NOT_ADMINS)
                .refuse("GET /api/admin/audit-logs/exports/{id}",
                        () -> get("/api/admin/audit-logs/exports/" + UUID.randomUUID()), NOT_ADMINS)
                .refuse("DELETE /api/admin/audit-logs/exports/{id}",
                        () -> delete("/api/admin/audit-logs/exports/" + UUID.randomUUID()), NOT_ADMINS)
                .refuse("POST /api/admin/audit-logs/exports/{id}/link",
                        () -> post("/api/admin/audit-logs/exports/" + UUID.randomUUID() + "/link"), NOT_ADMINS)
                .refuse("GET /api/admin/settings", () -> get("/api/admin/settings"), NOT_ADMINS)
                .refuse("PUT /api/admin/settings/{key}", () -> put("/api/admin/settings/booking.payment-window-minutes")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"value\":\"60\",\"expectedVersion\":0}"),
                        NOT_ADMINS);

        matrix.assertCovers(Endpoints.of(context), "/api/admin/");
        matrix.assertRefused(mockMvc);
    }
}
