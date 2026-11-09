package com.flighthotel.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.ResultActions;

import com.flighthotel.events.audit.AuditEventRecorded;
import com.jayway.jsonpath.JsonPath;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/**
 * Phase 11 §11.2: sign-in per portal. Each role signs in at its own page; admins also at the hotel manager and support
 * pages. Anyone else gets {@code 403 PORTAL_NOT_ALLOWED} after the right password: no tokens, no cookie, no failed
 * attempt, but a login history entry and an audit entry. Wrong passwords, lockout and the account status rules stay as
 * they were, and without {@code portal} nothing changes.
 */
class PortalSignInIntegrationTest extends IdentityIntegrationTest {

    @Test
    void eachRoleSignsInAtItsOwnPortalAndAdminsAlsoAtTheStaffOnes() throws Exception {
        signIn(CUSTOMER_EMAIL, DEMO_PASSWORD, "CUSTOMER").andExpect(status().isOk())
                .andExpect(jsonPath("$.user.roles[0]").value("CUSTOMER"));
        signIn(MANAGER_EMAIL, DEMO_PASSWORD, "HOTEL_MANAGER").andExpect(status().isOk());
        signIn(SUPPORT_EMAIL, DEMO_PASSWORD, "SUPPORT").andExpect(status().isOk());
        for (String portal : List.of("ADMIN", "HOTEL_MANAGER", "SUPPORT")) {
            MockHttpServletResponse response = signIn(ADMIN_EMAIL, DEMO_PASSWORD, portal)
                    .andExpect(status().isOk()).andReturn().getResponse();
            assertThat(response.getCookie(REFRESH_COOKIE)).as(portal).isNotNull();
            assertThat((String) JsonPath.read(response.getContentAsString(), "$.accessToken")).isNotBlank();
        }
        // Without a portal: any role, as before (the existing sign-in page and API clients).
        signIn(SUPPORT_EMAIL, DEMO_PASSWORD, null).andExpect(status().isOk());
    }

    @Test
    void anotherRolesPortalIsRefusedAfterTheRightPasswordWithoutASession() throws Exception {
        Map<String, List<String>> allowed = Map.of(
                CUSTOMER_EMAIL, List.of("CUSTOMER"),
                MANAGER_EMAIL, List.of("HOTEL_MANAGER"),
                SUPPORT_EMAIL, List.of("SUPPORT"),
                ADMIN_EMAIL, List.of("ADMIN", "HOTEL_MANAGER", "SUPPORT"));
        List<String[]> refused = List.of(
                new String[] {CUSTOMER_EMAIL, "ADMIN"}, new String[] {CUSTOMER_EMAIL, "HOTEL_MANAGER"},
                new String[] {CUSTOMER_EMAIL, "SUPPORT"}, new String[] {MANAGER_EMAIL, "ADMIN"},
                new String[] {MANAGER_EMAIL, "SUPPORT"}, new String[] {MANAGER_EMAIL, "CUSTOMER"},
                new String[] {SUPPORT_EMAIL, "ADMIN"}, new String[] {SUPPORT_EMAIL, "HOTEL_MANAGER"},
                new String[] {SUPPORT_EMAIL, "CUSTOMER"}, new String[] {ADMIN_EMAIL, "CUSTOMER"});
        for (String[] attempt : refused) {
            String email = attempt[0];
            long sessionsBefore = refreshTokens(email);
            MockHttpServletResponse response = signIn(email, DEMO_PASSWORD, attempt[1])
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("PORTAL_NOT_ALLOWED"))
                    .andExpect(jsonPath("$.status").value(403))
                    .andExpect(jsonPath("$.accessToken").doesNotExist())
                    .andReturn().getResponse();
            List<String> portals = JsonPath.read(response.getContentAsString(), "$.details.portals");
            assertThat(portals).as("%s at %s", email, attempt[1]).isEqualTo(allowed.get(email));
            assertThat(response.getHeader(HttpHeaders.SET_COOKIE)).as("no refresh cookie").isNull();
            assertThat(refreshTokens(email)).as("no session started").isEqualTo(sessionsBefore);
        }
    }

    @Test
    void aRefusedPortalIsNoFailedAttemptButIsInTheHistoryAndTheAuditLog() throws Exception {
        Session customer = newCustomer("portal");
        for (int attempt = 1; attempt <= 4; attempt++) {
            signIn(customer.email(), "Wrong2026Password", "CUSTOMER").andExpect(status().isUnauthorized());
        }
        // Three refusals with the right password: had they counted, the fifth attempt would have locked the account.
        for (String portal : List.of("ADMIN", "SUPPORT", "HOTEL_MANAGER")) {
            signIn(customer.email(), PASSWORD, portal).andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("PORTAL_NOT_ALLOWED"));
        }
        assertThat(failedLogins(customer.userId())).isEqualTo(4);

        String history = mockMvc.perform(get("/api/customers/security/login-history?size=20").with(bearer(customer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].success").value(false))
                .andExpect(jsonPath("$.content[0].failureReason").value("PORTAL_NOT_ALLOWED"))
                .andReturn().getResponse().getContentAsString();
        List<String> reasons = JsonPath.read(history, "$.content[*].failureReason");
        assertThat(reasons).filteredOn("PORTAL_NOT_ALLOWED"::equals).hasSize(3);
        assertThat(reasons).filteredOn("BAD_PASSWORD"::equals).hasSize(4);

        List<AuditEventRecorded> audits = auditEvents(customer.userId());
        assertThat(audits).hasSize(3).allSatisfy(audit -> {
            assertThat(audit.getAction()).isEqualTo("LOGIN_PORTAL_REFUSED");
            assertThat(audit.getEntityType()).isEqualTo("USER");
            assertThat(audit.getDetails()).containsEntry("roles", "CUSTOMER");
        });
        assertThat(audits).extracting(audit -> audit.getDetails().get("portal"))
                .containsExactlyInAnyOrder("ADMIN", "SUPPORT", "HOTEL_MANAGER");

        // The right page works, and a success clears the failed attempts as before.
        signIn(customer.email(), PASSWORD, "CUSTOMER").andExpect(status().isOk());
        assertThat(failedLogins(customer.userId())).isZero();
    }

    @Test
    void wrongPasswordsLockoutAndAccountStatusStayAsTheyWere() throws Exception {
        // A wrong password never reveals the portals: the usual 401, and it counts.
        Session customer = newCustomer("portal-rules");
        signIn(customer.email(), "Wrong2026Password", "ADMIN")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"))
                .andExpect(jsonPath("$.details.portals").doesNotExist());
        assertThat(failedLogins(customer.userId())).isEqualTo(1);
        signIn("nobody-" + System.nanoTime() + "@example.com", "Wrong2026Password", "ADMIN")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));

        // Locked: 423 at every portal, even with the right password.
        for (int attempt = 2; attempt <= 5; attempt++) {
            signIn(customer.email(), "Wrong2026Password", "CUSTOMER");
        }
        signIn(customer.email(), PASSWORD, "ADMIN").andExpect(status().isLocked())
                .andExpect(jsonPath("$.code").value("ACCOUNT_LOCKED"));
        signIn(customer.email(), PASSWORD, "CUSTOMER").andExpect(status().isLocked());

        // Not verified yet: the account status comes first, as without a portal.
        String unverified = uniqueEmail("portal-unverified");
        register(unverified, PASSWORD);
        signIn(unverified, PASSWORD, "ADMIN").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EMAIL_NOT_VERIFIED"));

        // Only the four portals exist.
        signIn(CUSTOMER_EMAIL, DEMO_PASSWORD, "PARTNER")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("portal"));
        signIn(CUSTOMER_EMAIL, DEMO_PASSWORD, "customer").andExpect(status().isBadRequest());
    }

    // ------------------------------------------------------------------ helpers

    private ResultActions signIn(String email, String password, String portal) throws Exception {
        String body = portal == null
                ? "{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password)
                : "{\"email\":\"%s\",\"password\":\"%s\",\"portal\":\"%s\"}".formatted(email, password, portal);
        return mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private long refreshTokens(String email) {
        return jdbcClient.sql("SELECT COUNT(*) FROM refresh_tokens t JOIN users u ON u.id = t.user_id "
                        + "WHERE u.email = :email")
                .param("email", email).query(Long.class).single();
    }

    private int failedLogins(String userId) {
        return jdbcClient.sql("SELECT failed_login_count FROM users WHERE id = UUID_TO_BIN(:id)")
                .param("id", userId).query(Integer.class).single();
    }

    /** The audit entries of this user, as reporting-service would receive them (from the outbox). */
    private List<AuditEventRecorded> auditEvents(String userId) {
        List<byte[]> payloads = jdbcClient.sql("SELECT payload FROM outbox_events WHERE aggregate_type = 'audit' "
                        + "AND aggregate_id = :id ORDER BY created_at")
                .param("id", userId).query(byte[].class).list();
        try (KafkaAvroDeserializer deserializer = new KafkaAvroDeserializer()) {
            deserializer.configure(Map.of("schema.registry.url", "mock://identity-it", "specific.avro.reader", true),
                    false);
            return payloads.stream()
                    .map(payload -> (AuditEventRecorded) deserializer.deserialize("audit.events", payload))
                    .toList();
        }
    }
}
