package com.flighthotel.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import com.flighthotel.events.identity.AuthEmailRequested;
import com.jayway.jsonpath.JsonPath;

/** API_DOCUMENTATION.md §4: admin user management, and 401/403 per role. */
class AdminUserIntegrationTest extends IdentityIntegrationTest {

    @Test
    void onlyAdminsMayManageUsers() throws Exception {
        mockMvc.perform(get("/api/admin/users"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        for (String email : new String[] {CUSTOMER_EMAIL, MANAGER_EMAIL, SUPPORT_EMAIL}) {
            Session session = login(email, DEMO_PASSWORD);
            mockMvc.perform(get("/api/admin/users").with(bearer(session)))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("FORBIDDEN"));
            mockMvc.perform(post("/api/admin/users").with(bearer(session)).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"email\":\"x@example.com\",\"firstName\":\"X\",\"lastName\":\"Y\",\"roles\":[\"ADMIN\"]}"))
                    .andExpect(status().isForbidden());
        }

        mockMvc.perform(get("/api/admin/users").with(bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray());
    }

    @Test
    void demoUsersHaveTheirRoles() throws Exception {
        mockMvc.perform(get("/api/admin/users?search=@flighthotel.local&sort=email,asc").with(bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(4))
                .andExpect(jsonPath("$.content[0].email").value(ADMIN_EMAIL))
                .andExpect(jsonPath("$.content[0].roles[0]").value("ADMIN"))
                .andExpect(jsonPath("$.content[1].email").value(CUSTOMER_EMAIL))
                .andExpect(jsonPath("$.content[2].roles[0]").value("HOTEL_MANAGER"))
                .andExpect(jsonPath("$.content[3].roles[0]").value("SUPPORT_AGENT"));
    }

    @Test
    void createStaffUserWhoAcceptsTheInvitation() throws Exception {
        Session admin = admin();
        String email = uniqueEmail("manager");

        String body = mockMvc.perform(post("/api/admin/users").with(bearer(admin)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"firstName\":\"Ravi\",\"lastName\":\"Kumar\",\"roles\":[\"hotel_manager\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING_VERIFICATION"))
                .andExpect(jsonPath("$.roles[0]").value("HOTEL_MANAGER"))
                .andExpect(jsonPath("$.emailVerified").value(false))
                .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(body, "$.id");

        mockMvc.perform(post("/api/admin/users").with(bearer(admin)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"firstName\":\"Ravi\",\"lastName\":\"Kumar\",\"roles\":[\"ADMIN\"]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EMAIL_ALREADY_REGISTERED"));

        AuthEmailRequested invitation = lastEmail(email, "ACCOUNT_INVITATION");
        assertThat(Duration.between(invitation.getRequestedAt(), invitation.getExpiresAt()))
                .isCloseTo(Duration.ofHours(72), Duration.ofSeconds(5));
        // Phase 11: the e-mail leads to the hotel manager sign-in once the password is set.
        assertThat(invitation.getPortal()).isEqualTo("hotel-manager");

        mockMvc.perform(post("/api/auth/reset-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + invitation.getToken() + "\",\"newPassword\":\"Manager2026Pass\"}"))
                .andExpect(status().isOk());

        // Setting a password ends all sessions, revoking tokens issued before the next second (JWT "iat" has
        // second precision). A person never logs in that fast; the test waits.
        Thread.sleep(1_100);
        Session manager = login(email, "Manager2026Pass");
        mockMvc.perform(get("/api/customers/profile").with(bearer(manager)))
                .andExpect(jsonPath("$.roles[0]").value("HOTEL_MANAGER"))
                .andExpect(jsonPath("$.emailVerified").value(true));
        mockMvc.perform(get("/api/admin/users/" + id).with(bearer(admin)))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.lastLoginAt").exists());
    }

    @Test
    void deactivationEndsEverySessionImmediately() throws Exception {
        Session admin = admin();
        Session customer = newCustomer("deactivate");

        mockMvc.perform(patch("/api/admin/users/" + customer.userId() + "/status").with(bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"DEACTIVATED\",\"reason\":\"Fraud check\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DEACTIVATED"));

        mockMvc.perform(get("/api/customers/profile").with(bearer(customer))).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(customer.refreshCookie()))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + customer.email() + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_DISABLED"));

        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'audit' "
                        + "AND aggregate_id = :id AND event_type LIKE '%AuditEventRecorded'")
                .param("id", customer.userId()).query(Long.class).single()).isEqualTo(1);

        mockMvc.perform(patch("/api/admin/users/" + customer.userId() + "/status").with(bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        Thread.sleep(1_100); // tokens issued in the second of the deactivation stay revoked (per-second "iat")
        Session again = login(customer.email(), PASSWORD);
        mockMvc.perform(get("/api/customers/profile").with(bearer(again))).andExpect(status().isOk());
    }

    @Test
    void adminsCannotLockThemselvesOut() throws Exception {
        Session admin = admin();

        mockMvc.perform(patch("/api/admin/users/" + admin.userId() + "/status").with(bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DEACTIVATED\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("CANNOT_CHANGE_OWN_ACCOUNT"));
        mockMvc.perform(put("/api/admin/users/" + admin.userId() + "/roles").with(bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"roles\":[\"CUSTOMER\"]}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("CANNOT_CHANGE_OWN_ACCOUNT"));
    }

    @Test
    void roleChangeTakesEffectOnTheNextRefresh() throws Exception {
        Session admin = admin();
        Session user = newCustomer("promote");

        mockMvc.perform(put("/api/admin/users/" + user.userId() + "/roles").with(bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"roles\":[\"SUPPORT_AGENT\",\"CUSTOMER\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roles.length()").value(2));

        // The old token still carries the old roles, so it is no longer accepted.
        mockMvc.perform(get("/api/customers/profile").with(bearer(user)))
                .andExpect(status().isUnauthorized());

        Thread.sleep(1_100);
        String body = mockMvc.perform(post("/api/auth/refresh").with(xhr()).cookie(user.refreshCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.roles", hasItem("SUPPORT_AGENT")))
                .andExpect(jsonPath("$.user.permissions", hasItem("BOOKING_READ_ANY")))
                .andReturn().getResponse().getContentAsString();
        mockMvc.perform(get("/api/customers/profile").with(bearer((String) JsonPath.read(body, "$.accessToken"))))
                .andExpect(status().isOk());

        mockMvc.perform(put("/api/admin/users/" + user.userId() + "/roles").with(bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"roles\":[\"PILOT\"]}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("UNKNOWN_ROLE"));
    }

    @Test
    void searchFiltersAndIgnoresUnknownSortFields() throws Exception {
        Session admin = admin();
        newCustomer("searchable");

        mockMvc.perform(get("/api/admin/users?role=CUSTOMER&status=ACTIVE&size=100&sort=passwordHash,asc")
                        .with(bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].roles", everyItem(hasItem("CUSTOMER"))))
                .andExpect(jsonPath("$.content[*].status", everyItem(org.hamcrest.Matchers.is("ACTIVE"))))
                .andExpect(jsonPath("$.content[0].passwordHash").doesNotExist());

        mockMvc.perform(get("/api/admin/users?search=searchable").with(bearer(admin)))
                .andExpect(jsonPath("$.totalElements").value(1));

        mockMvc.perform(get("/api/admin/users?status=NOPE").with(bearer(admin)))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/admin/users/" + java.util.UUID.randomUUID()).with(bearer(admin)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
    }
}
