package com.flighthotel.notification;

import static com.flighthotel.testsupport.RoleTokens.CUSTOMER;
import static com.flighthotel.testsupport.RoleTokens.HOTEL_MANAGER;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;

import com.flighthotel.testsupport.AccessMatrix;
import com.flighthotel.testsupport.Endpoints;

/**
 * Who may call what (SECURITY_GUIDE.md): only the newsletter links are public; notifications, documents, tickets and
 * the live stream need a login, and the agents' ticket queue refuses customers and hotel managers. Requests are valid,
 * so a refusal proves the permission check and not request validation.
 */
class EndpointSecurityTest extends NotificationIntegrationTest {

    private static final Set<String> PUBLIC = Set.of(
            "POST /api/newsletter/subscribe",
            "POST /api/newsletter/confirm",
            "POST /api/newsletter/unsubscribe");

    @Autowired
    ApplicationContext context;

    @Test
    void everyEndpointExceptThePublicOnesNeedsALogin() throws Exception {
        AccessMatrix.everyEndpointNeedsALoginExcept(mockMvc, Endpoints.of(context), PUBLIC);
    }

    @Test
    void theTicketQueueIsForSupportAgents() throws Exception {
        String ticket = "/api/admin/support/tickets/" + UUID.randomUUID();
        AccessMatrix matrix = new AccessMatrix()
                .refuse("GET /api/admin/support/tickets", () -> get("/api/admin/support/tickets"),
                        CUSTOMER, HOTEL_MANAGER)
                .refuse("GET /api/admin/support/summary", () -> get("/api/admin/support/summary"),
                        CUSTOMER, HOTEL_MANAGER)
                .refuse("GET /api/admin/support/metrics",
                        () -> get("/api/admin/support/metrics?range=LAST_12_MONTHS&interval=MONTH"),
                        CUSTOMER, HOTEL_MANAGER)
                .refuse("POST /api/admin/support/tickets/{id}/assign", () -> post(ticket + "/assign")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"), CUSTOMER, HOTEL_MANAGER)
                .refuse("PATCH /api/admin/support/tickets/{id}/status", () -> patch(ticket + "/status")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"RESOLVED\",\"priority\":\"HIGH\"}"),
                        CUSTOMER, HOTEL_MANAGER);

        matrix.assertCovers(Endpoints.of(context), "/api/admin/");
        matrix.assertRefused(mockMvc);
    }
}
