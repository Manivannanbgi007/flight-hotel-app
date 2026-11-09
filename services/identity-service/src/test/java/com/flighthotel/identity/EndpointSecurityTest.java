package com.flighthotel.identity;

import static com.flighthotel.testsupport.RoleTokens.CUSTOMER;
import static com.flighthotel.testsupport.RoleTokens.HOTEL_MANAGER;
import static com.flighthotel.testsupport.RoleTokens.SUPPORT_AGENT;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.flighthotel.testsupport.AccessMatrix;
import com.flighthotel.testsupport.Endpoints;

/**
 * Who may call what (SECURITY_GUIDE.md): sign-up, login and the key set are public, every account endpoint needs a
 * login, and user administration is for admins only: support agents may read users elsewhere (USER_READ_ANY) but
 * not manage them here. Requests are valid, so a refusal proves the permission check and not request validation.
 */
class EndpointSecurityTest extends IdentityIntegrationTest {

    private static final Set<String> PUBLIC = Set.of(
            "POST /api/auth/register",
            "POST /api/auth/verify-email",
            "POST /api/auth/resend-verification",
            "POST /api/auth/login",
            "POST /api/auth/refresh",
            "POST /api/auth/logout",
            "POST /api/auth/forgot-password",
            "POST /api/auth/reset-password",
            "GET /.well-known/jwks.json");

    private static final String[] NOT_ADMINS = {CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT};

    @Autowired
    ApplicationContext context;

    @Test
    void everyEndpointExceptThePublicOnesNeedsALogin() throws Exception {
        AccessMatrix.everyEndpointNeedsALoginExcept(mockMvc, Endpoints.of(context), PUBLIC);
    }

    @Test
    void onlyAdminsManageUsers() throws Exception {
        String user = "/api/admin/users/" + UUID.randomUUID();
        AccessMatrix matrix = new AccessMatrix()
                .refuse("GET /api/admin/users", () -> get("/api/admin/users"), NOT_ADMINS)
                .refuse("GET /api/admin/users/{id}", () -> get(user), NOT_ADMINS)
                .refuse("POST /api/admin/users", () -> json(post("/api/admin/users"), """
                        {"email":"new.agent@example.com","firstName":"Neha","lastName":"Iyer",
                         "roles":["SUPPORT_AGENT"]}"""), NOT_ADMINS)
                .refuse("PATCH /api/admin/users/{id}/status",
                        () -> json(patch(user + "/status"), "{\"status\":\"DEACTIVATED\",\"reason\":\"Left\"}"),
                        NOT_ADMINS)
                // An agent making themselves an admin is the attack this guards against.
                .refuse("PUT /api/admin/users/{id}/roles",
                        () -> json(put(user + "/roles"), "{\"roles\":[\"ADMIN\"]}"), NOT_ADMINS);

        matrix.assertCovers(Endpoints.of(context), "/api/admin/");
        matrix.assertRefused(mockMvc);
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }
}
