package com.flighthotel.booking;

import static com.flighthotel.testsupport.RoleTokens.ADMIN;
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
 * Who may call what (SECURITY_GUIDE.md): every endpoint needs a login except the public offers, and every staff
 * endpoint refuses the roles without its permission. Requests are valid, so a refusal proves the permission check
 * and not request validation. The gateway checks roles too; this is the service's own line of defence.
 */
class EndpointSecurityTest extends BookingIntegrationTest {

    private static final Set<String> PUBLIC = Set.of("GET /api/offers");

    private static final String COUPON = """
            {"code":"SEC-CHECK","title":"Security check","discountType":"PERCENT","discountValue":10,
             "validFrom":"2026-01-01T00:00:00Z","validTo":"2030-01-01T00:00:00Z","version":0}""";
    private static final String OFFER = """
            {"title":"Security check offer","couponId":"%s","validFrom":"2026-01-01T00:00:00Z",
             "validTo":"2030-01-01T00:00:00Z","version":0}""".formatted(UUID.randomUUID());

    @Autowired
    ApplicationContext context;

    @Test
    void everyEndpointExceptThePublicOnesNeedsALogin() throws Exception {
        AccessMatrix.everyEndpointNeedsALoginExcept(mockMvc, Endpoints.of(context), PUBLIC);
    }

    @Test
    void staffEndpointsRefuseRolesWithoutThePermission() throws Exception {
        String id = UUID.randomUUID().toString();
        AccessMatrix matrix = new AccessMatrix()
                // BOOKING_READ_ANY: agents may search, customers and hotel managers may not.
                .refuse("GET /api/admin/bookings", () -> get("/api/admin/bookings"), CUSTOMER, HOTEL_MANAGER)
                .refuse("GET /api/support/bookings", () -> get("/api/support/bookings"), CUSTOMER, HOTEL_MANAGER)
                // BOOKING_MANAGE_ANY
                .refuse("POST /api/support/bookings/{bookingId}/escalate",
                        () -> json(post("/api/support/bookings/" + id + "/escalate"), "{\"note\":\"Customer called\"}"),
                        CUSTOMER, HOTEL_MANAGER)
                .refuse("POST /api/support/bookings/{bookingId}/resolve",
                        () -> json(post("/api/support/bookings/" + id + "/resolve"), "{\"note\":\"Sorted\"}"),
                        CUSTOMER, HOTEL_MANAGER)
                // REFUND_MANAGE: not even support agents.
                .refuse("POST /api/admin/bookings/{bookingId}/refunds",
                        () -> json(post("/api/admin/bookings/" + id + "/refunds"),
                                "{\"amount\":100.00,\"reason\":\"Goodwill for the delay\"}")
                                .header("Idempotency-Key", "key-" + UUID.randomUUID()),
                        CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                .refuse("POST /api/support/bookings/{bookingId}/retry-refund",
                        () -> post("/api/support/bookings/" + id + "/retry-refund"),
                        CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                // COUPON_MANAGE: admins only.
                .refuse("GET /api/admin/coupons", () -> get("/api/admin/coupons"), CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                .refuse("GET /api/admin/coupons/{id}", () -> get("/api/admin/coupons/" + id),
                        CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                .refuse("POST /api/admin/coupons", () -> json(post("/api/admin/coupons"), COUPON),
                        CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                .refuse("PUT /api/admin/coupons/{id}", () -> json(put("/api/admin/coupons/" + id), COUPON),
                        CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                .refuse("PATCH /api/admin/coupons/{id}/status",
                        () -> json(patch("/api/admin/coupons/" + id + "/status"), "{\"status\":\"INACTIVE\"}"),
                        CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                .refuse("GET /api/admin/offers", () -> get("/api/admin/offers"), CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                .refuse("POST /api/admin/offers", () -> json(post("/api/admin/offers"), OFFER),
                        CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                .refuse("PUT /api/admin/offers/{id}", () -> json(put("/api/admin/offers/" + id), OFFER),
                        CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                .refuse("PATCH /api/admin/offers/{id}/status",
                        () -> json(patch("/api/admin/offers/" + id + "/status"), "{\"status\":\"INACTIVE\"}"),
                        CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT)
                // Phase 11: every signed-in user gets their own dashboard figures (never anyone else's).
                .allow("GET /api/bookings/summary", () -> get("/api/bookings/summary?range=THIS_YEAR"),
                        CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT, ADMIN);

        matrix.assertCovers(Endpoints.of(context), "/api/admin/", "/api/support/");
        matrix.assertRefused(mockMvc);
        matrix.assertAllowed(mockMvc);
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }
}
