package com.flighthotel.hotel;

import static com.flighthotel.testsupport.RoleTokens.CUSTOMER;
import static com.flighthotel.testsupport.RoleTokens.HOTEL_MANAGER;
import static com.flighthotel.testsupport.RoleTokens.SUPPORT_AGENT;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.flighthotel.testsupport.AccessMatrix;
import com.flighthotel.testsupport.Endpoints;

/**
 * Who may call what (SECURITY_GUIDE.md): the hotel search and details are public, everything else needs a login;
 * admin endpoints refuse everybody but admins, the manager portal refuses customers and support agents (which hotel a
 * manager may reach is tested in {@link HotelManagementIntegrationTest} and {@link HotelFrontDeskIntegrationTest}).
 * Requests are valid, so a refusal proves the permission check and not request validation.
 */
class EndpointSecurityTest extends HotelIntegrationTest {

    private static final Set<String> PUBLIC = Set.of(
            "GET /api/hotels/search",
            "GET /api/hotels/destinations",
            "GET /api/hotels/amenities",
            "GET /api/hotels/recommended",
            "GET /api/hotels/{idOrSlug}",
            "GET /api/hotels/{idOrSlug}/reviews",
            "GET /api/hotels/{hotelId}/rooms",
            "GET /api/hotels/quotes/{quoteId}",
            "GET /api/hotels/images/{imageId}",
            "POST /api/hotels/availability",
            "GET /api/reviews/featured");

    private static final String[] NOT_ADMINS = {CUSTOMER, HOTEL_MANAGER, SUPPORT_AGENT};
    private static final String[] NOT_HOTEL_STAFF = {CUSTOMER, SUPPORT_AGENT};

    private static final String PROFILE = """
            {"name":"Security Check Hotel","propertyType":"HOTEL","addressLine":"1 Beach Road","city":"Goa",
             "countryCode":"IN","checkInTime":"14:00","checkOutTime":"11:00","amenities":[],"policies":[],
             "version":0}""";
    private static final String ROOM_TYPE = """
            {"name":"Deluxe","maxAdults":2,"maxChildren":1,"bedConfiguration":"1 king bed","totalRooms":5,
             "status":"ACTIVE","sortOrder":0,"amenities":[]}""";
    private static final String RATE_PLAN = """
            {"name":"Room only","basePricePerNight":3000.00,"breakfastIncluded":false,"refundable":true,
             "freeCancellationHours":48,"cancellationFeePercent":25,"status":"ACTIVE"}""";

    @Autowired
    ApplicationContext context;

    @Test
    void everyEndpointExceptThePublicOnesNeedsALogin() throws Exception {
        AccessMatrix.everyEndpointNeedsALoginExcept(mockMvc, Endpoints.of(context), PUBLIC);
    }

    @Test
    void staffEndpointsRefuseRolesWithoutThePermission() throws Exception {
        String hotel = "/api/admin/hotels/" + UUID.randomUUID();
        String review = "/api/admin/reviews/" + UUID.randomUUID();
        String portal = "/api/hotel-manager/hotels/" + UUID.randomUUID();
        String reservation = portal + "/reservations/" + UUID.randomUUID();
        String roomType = portal + "/room-types/" + UUID.randomUUID();
        String ratePlan = roomType + "/rate-plans/" + UUID.randomUUID();
        LocalDate from = LocalDate.now().plusDays(10);

        AccessMatrix matrix = new AccessMatrix()
                // Admin: hotels, managers, the search index, occupancy across hotels.
                .refuse("GET /api/admin/hotels", () -> get("/api/admin/hotels"), NOT_ADMINS)
                .refuse("POST /api/admin/hotels", () -> json(post("/api/admin/hotels"), """
                        {"name":"Security Check Hotel","propertyType":"HOTEL","addressLine":"1 Beach Road",
                         "city":"Goa","countryCode":"IN","starRating":4}"""), NOT_ADMINS)
                .refuse("PATCH /api/admin/hotels/{hotelId}/status",
                        () -> json(patch(hotel + "/status"), "{\"status\":\"INACTIVE\"}"), NOT_ADMINS)
                .refuse("GET /api/admin/hotels/{hotelId}/managers", () -> get(hotel + "/managers"), NOT_ADMINS)
                .refuse("POST /api/admin/hotels/{hotelId}/managers",
                        () -> json(post(hotel + "/managers"), "{\"email\":\"manager@example.com\"}"), NOT_ADMINS)
                .refuse("DELETE /api/admin/hotels/{hotelId}/managers/{userId}",
                        () -> delete(hotel + "/managers/" + UUID.randomUUID()), NOT_ADMINS)
                .refuse("POST /api/admin/hotels/reindex", () -> post("/api/admin/hotels/reindex"), NOT_ADMINS)
                .refuse("GET /api/admin/hotels/occupancy", () -> get("/api/admin/hotels/occupancy"), NOT_ADMINS)
                .refuse("GET /api/admin/hotels/occupancy/export",
                        () -> get("/api/admin/hotels/occupancy/export?format=csv"), NOT_ADMINS)
                // Review moderation (REVIEW_MODERATE).
                .refuse("GET /api/admin/reviews", () -> get("/api/admin/reviews"), NOT_ADMINS)
                .refuse("POST /api/admin/reviews/{reviewId}/approve", () -> post(review + "/approve"), NOT_ADMINS)
                .refuse("POST /api/admin/reviews/{reviewId}/reject",
                        () -> json(post(review + "/reject"), "{\"reason\":\"Contains a phone number\"}"), NOT_ADMINS)
                // The hotel manager portal (HOTEL_MANAGE_ASSIGNED or HOTEL_MANAGE_ANY).
                .refuse("GET /api/hotel-manager/hotels", () -> get("/api/hotel-manager/hotels"), NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}", () -> get(portal), NOT_HOTEL_STAFF)
                .refuse("PUT /api/hotel-manager/hotels/{hotelId}", () -> json(put(portal), PROFILE), NOT_HOTEL_STAFF)
                .refuse("POST /api/hotel-manager/hotels/{hotelId}/images",
                        () -> multipart(portal + "/images").file(new MockMultipartFile("file", "room.jpg",
                                MediaType.IMAGE_JPEG_VALUE, new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF})),
                        NOT_HOTEL_STAFF)
                .refuse("PATCH /api/hotel-manager/hotels/{hotelId}/images/{imageId}",
                        () -> json(patch(portal + "/images/" + UUID.randomUUID()), "{\"caption\":\"Pool\"}"),
                        NOT_HOTEL_STAFF)
                .refuse("DELETE /api/hotel-manager/hotels/{hotelId}/images/{imageId}",
                        () -> delete(portal + "/images/" + UUID.randomUUID()), NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/room-types", () -> get(portal + "/room-types"),
                        NOT_HOTEL_STAFF)
                .refuse("POST /api/hotel-manager/hotels/{hotelId}/room-types",
                        () -> json(post(portal + "/room-types"), ROOM_TYPE), NOT_HOTEL_STAFF)
                .refuse("PUT /api/hotel-manager/hotels/{hotelId}/room-types/{roomTypeId}",
                        () -> json(put(roomType), ROOM_TYPE), NOT_HOTEL_STAFF)
                .refuse("POST /api/hotel-manager/hotels/{hotelId}/room-types/{roomTypeId}/rate-plans",
                        () -> json(post(roomType + "/rate-plans"), RATE_PLAN), NOT_HOTEL_STAFF)
                .refuse("PUT /api/hotel-manager/hotels/{hotelId}/room-types/{roomTypeId}/rate-plans/{ratePlanId}",
                        () -> json(put(ratePlan), RATE_PLAN), NOT_HOTEL_STAFF)
                .refuse("POST /api/hotel-manager/hotels/{hotelId}/room-types/{roomTypeId}/rate-plans/{ratePlanId}"
                                + "/seasonal-rates",
                        () -> json(post(ratePlan + "/seasonal-rates"), """
                                {"label":"Diwali","startDate":"%s","endDate":"%s","pricePerNight":4500.00,
                                 "priority":1}""".formatted(from, from.plusDays(5))), NOT_HOTEL_STAFF)
                .refuse("DELETE /api/hotel-manager/hotels/{hotelId}/room-types/{roomTypeId}/rate-plans/{ratePlanId}"
                                + "/seasonal-rates/{seasonalRateId}",
                        () -> delete(ratePlan + "/seasonal-rates/" + UUID.randomUUID()), NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/inventory",
                        () -> get(portal + "/inventory?from=" + from + "&to=" + from.plusDays(6)), NOT_HOTEL_STAFF)
                .refuse("PUT /api/hotel-manager/hotels/{hotelId}/inventory",
                        () -> json(put(portal + "/inventory"), """
                                {"roomTypeId":"%s","from":"%s","to":"%s","totalRooms":3}"""
                                .formatted(UUID.randomUUID(), from, from.plusDays(2))), NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/reviews", () -> get(portal + "/reviews"),
                        NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/reviews/summary", () -> get(portal + "/reviews/summary"),
                        NOT_HOTEL_STAFF)
                // The front desk.
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/reservations", () -> get(portal + "/reservations"),
                        NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/reservations/summary",
                        () -> get(portal + "/reservations/summary"), NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/reservations/{reservationId}",
                        () -> get(reservation), NOT_HOTEL_STAFF)
                .refuse("POST /api/hotel-manager/hotels/{hotelId}/reservations/{reservationId}/check-in",
                        () -> post(reservation + "/check-in"), NOT_HOTEL_STAFF)
                .refuse("POST /api/hotel-manager/hotels/{hotelId}/reservations/{reservationId}/check-out",
                        () -> post(reservation + "/check-out"), NOT_HOTEL_STAFF)
                .refuse("POST /api/hotel-manager/hotels/{hotelId}/reservations/{reservationId}/no-show",
                        () -> post(reservation + "/no-show"), NOT_HOTEL_STAFF)
                .refuse("POST /api/hotel-manager/hotels/{hotelId}/reservations/{reservationId}/cancel",
                        () -> json(post(reservation + "/cancel"), "{\"reason\":\"Overbooked tonight\"}"),
                        NOT_HOTEL_STAFF)
                // Hotel reports.
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/dashboard",
                        () -> get(portal + "/dashboard?range=LAST_12_MONTHS&interval=MONTH"), NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/reports/occupancy",
                        () -> get(portal + "/reports/occupancy"), NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/reports/occupancy/export",
                        () -> get(portal + "/reports/occupancy/export?format=csv"), NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/reports/room-types",
                        () -> get(portal + "/reports/room-types"), NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/reports/revenue",
                        () -> get(portal + "/reports/revenue"), NOT_HOTEL_STAFF)
                .refuse("GET /api/hotel-manager/hotels/{hotelId}/reports/revenue/export",
                        () -> get(portal + "/reports/revenue/export?format=csv"), NOT_HOTEL_STAFF);

        matrix.assertCovers(Endpoints.of(context), "/api/admin/", "/api/hotel-manager/");
        matrix.assertRefused(mockMvc);
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }
}
