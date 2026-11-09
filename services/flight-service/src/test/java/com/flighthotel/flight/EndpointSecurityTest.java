package com.flighthotel.flight;

import static com.flighthotel.testsupport.RoleTokens.CUSTOMER;
import static com.flighthotel.testsupport.RoleTokens.HOTEL_MANAGER;
import static com.flighthotel.testsupport.RoleTokens.SUPPORT_AGENT;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;

import com.flighthotel.testsupport.AccessMatrix;
import com.flighthotel.testsupport.Endpoints;

/**
 * Who may call what (SECURITY_GUIDE.md): flight search is public, and only admins manage the flight providers. Requests
 * are valid, so a refusal proves the permission check and not request validation.
 */
class EndpointSecurityTest extends FlightIntegrationTest {

    private static final Set<String> PUBLIC = Set.of(
            "GET /api/airports",
            "GET /api/airports/search",
            "GET /api/flights/search",
            "GET /api/flights/airlines",
            "GET /api/flights/popular-routes",
            "GET /api/flights/trips/{tripOfferId}",
            "POST /api/flights/revalidate");

    private static final String[] NOT_ADMINS = {CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT};

    @Autowired
    ApplicationContext context;

    @Test
    void everyEndpointExceptTheSearchNeedsALogin() throws Exception {
        AccessMatrix.everyEndpointNeedsALoginExcept(mockMvc, Endpoints.of(context), PUBLIC);
    }

    @Test
    void onlyAdminsManageFlightProviders() throws Exception {
        AccessMatrix matrix = new AccessMatrix()
                .refuse("GET /api/admin/flight-providers", () -> get("/api/admin/flight-providers"), NOT_ADMINS)
                // Switching the provider off would stop every flight search.
                .refuse("PATCH /api/admin/flight-providers/{code}", () -> patch("/api/admin/flight-providers/DEMO")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":false}"), NOT_ADMINS)
                .refuse("POST /api/admin/flight-providers/{code}/health-check",
                        () -> post("/api/admin/flight-providers/DEMO/health-check"), NOT_ADMINS);

        matrix.assertCovers(Endpoints.of(context), "/api/admin/");
        matrix.assertRefused(mockMvc);
    }
}
