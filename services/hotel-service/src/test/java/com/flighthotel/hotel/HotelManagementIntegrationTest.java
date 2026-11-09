package com.flighthotel.hotel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

import com.flighthotel.hotel.search.HotelIndexer;
import com.flighthotel.hotel.staff.KnownUserStore;
import com.flighthotel.hotel.staff.KnownUserStore.KnownUser;
import com.flighthotel.hotel.support.Uuids;
import com.jayway.jsonpath.JsonPath;

/**
 * Phase 4 exit check "manager can't access unassigned hotel", plus the whole manager/admin workflow: create, profile,
 * rooms, prices, photos, inventory, publish, searchable.
 */
class HotelManagementIntegrationTest extends HotelIntegrationTest {

    @Autowired
    KnownUserStore users;

    @Autowired
    HotelIndexer indexer;

    @Test
    void managersOnlyReachTheirAssignedHotels() throws Exception {
        UUID managerId = knownManager();
        UUID assigned = hotelId("Marina Bay Hotel");
        UUID other = hotelId("Backwater Retreat");
        assignByAdmin(assigned, managerId);

        mockMvc.perform(get("/api/hotel-manager/hotels").with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("Marina Bay Hotel"));
        mockMvc.perform(get("/api/hotel-manager/hotels/" + assigned).with(manager(managerId)))
                .andExpect(status().isOk());

        // Every manager endpoint refuses a hotel that is not assigned.
        mockMvc.perform(get("/api/hotel-manager/hotels/" + other).with(manager(managerId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("HOTEL_NOT_ASSIGNED"));
        mockMvc.perform(get("/api/hotel-manager/hotels/" + other + "/room-types").with(manager(managerId)))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/hotel-manager/hotels/" + other + "/inventory?from=" + inventory.today()
                        + "&to=" + inventory.today().plusDays(6)).with(manager(managerId)))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/hotel-manager/hotels/" + other + "/room-types").with(manager(managerId))
                        .contentType(MediaType.APPLICATION_JSON).content(roomTypeJson("Sneaky room", 2, null)))
                .andExpect(status().isForbidden());

        // Admins reach every hotel; customers and visitors none.
        mockMvc.perform(get("/api/hotel-manager/hotels/" + other).with(admin())).andExpect(status().isOk());
        mockMvc.perform(get("/api/hotel-manager/hotels").with(customer()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mockMvc.perform(get("/api/hotel-manager/hotels")).andExpect(status().isUnauthorized());

        // Unassigning ends the access.
        mockMvc.perform(delete("/api/admin/hotels/" + assigned + "/managers/" + managerId).with(admin()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/hotel-manager/hotels/" + assigned).with(manager(managerId)))
                .andExpect(status().isForbidden());
    }

    @Test
    void onlyHotelManagerAccountsCanBeAssigned() throws Exception {
        UUID hotel = hotelId("Marina Bay Hotel");
        UUID customerId = UUID.randomUUID();
        users.upsert(new KnownUser(customerId, "traveller-" + customerId + "@example.com", "Asha", "Rao",
                Set.of("CUSTOMER"), "ACTIVE"), Instant.now());

        mockMvc.perform(post("/api/admin/hotels/" + hotel + "/managers").with(admin())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"traveller-" + customerId + "@example.com\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("NOT_A_HOTEL_MANAGER"));
        mockMvc.perform(post("/api/admin/hotels/" + hotel + "/managers").with(admin())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"nobody@example.com\"}"))
                .andExpect(jsonPath("$.code").value("MANAGER_NOT_FOUND"));
        mockMvc.perform(post("/api/admin/hotels/" + hotel + "/managers").with(manager(UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"x@example.com\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void fromDraftToSearchableHotel() throws Exception {
        // Admin creates a draft; it cannot be published while empty.
        String created = mockMvc.perform(post("/api/admin/hotels").with(admin()).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Lighthouse Inn","propertyType":"HOTEL","addressLine":"1 Harbour Road",
                                 "city":"Testpur","countryCode":"IN","starRating":3}"""))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.slug").value("lighthouse-inn-testpur"))
                .andReturn().getResponse().getContentAsString();
        UUID hotel = UUID.fromString(JsonPath.read(created, "$.id"));
        mockMvc.perform(patch("/api/admin/hotels/" + hotel + "/status").with(admin())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("HOTEL_NOT_READY"))
                .andExpect(jsonPath("$.details.missing", hasItem("a cover photo")));

        UUID managerId = knownManager();
        assignByAdmin(hotel, managerId);

        // Profile: unknown amenities and stale versions are refused.
        String profile = mockMvc.perform(get("/api/hotel-manager/hotels/" + hotel).with(manager(managerId)))
                .andReturn().getResponse().getContentAsString();
        int version = JsonPath.read(profile, "$.version");
        mockMvc.perform(put("/api/hotel-manager/hotels/" + hotel).with(manager(managerId))
                        .contentType(MediaType.APPLICATION_JSON).content(profileJson("[\"FREE_WIFI\",\"HELIPAD\"]", version)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("UNKNOWN_AMENITY"));
        mockMvc.perform(put("/api/hotel-manager/hotels/" + hotel).with(manager(managerId))
                        .contentType(MediaType.APPLICATION_JSON).content(profileJson("[\"FREE_WIFI\",\"POOL\"]", version)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.amenities.length()").value(2))
                .andExpect(jsonPath("$.policies[0].type").value("PETS"));
        mockMvc.perform(put("/api/hotel-manager/hotels/" + hotel).with(manager(managerId))
                        .contentType(MediaType.APPLICATION_JSON).content(profileJson("[]", version)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONCURRENT_MODIFICATION"));

        // A room type creates its nights for the whole sales horizon.
        String room = mockMvc.perform(post("/api/hotel-manager/hotels/" + hotel + "/room-types").with(manager(managerId))
                        .contentType(MediaType.APPLICATION_JSON).content(roomTypeJson("Harbour Double", 4, null)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID roomType = UUID.fromString(JsonPath.read(room, "$.id"));
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM room_inventory WHERE room_type_id = :id")
                .param("id", Uuids.param(roomType)).query(Long.class).single()).isEqualTo(365);

        String plan = mockMvc.perform(post("/api/hotel-manager/hotels/" + hotel + "/room-types/" + roomType + "/rate-plans")
                        .with(manager(managerId)).contentType(MediaType.APPLICATION_JSON).content("""
                                {"name":"Room only","basePricePerNight":3000,"breakfastIncluded":false,"refundable":true,
                                 "freeCancellationHours":24,"cancellationFeePercent":50,"status":"ACTIVE"}"""))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.cancellationSummary").value("Free cancellation until 1 day before check-in"))
                .andReturn().getResponse().getContentAsString();
        UUID planId = UUID.fromString(JsonPath.read(plan, "$.id"));

        LocalDate seasonDay = offPeak(20);
        mockMvc.perform(post("/api/hotel-manager/hotels/" + hotel + "/room-types/" + roomType + "/rate-plans/" + planId
                        + "/seasonal-rates").with(manager(managerId)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"label\":\"Fair\",\"startDate\":\"" + seasonDay + "\",\"endDate\":\"" + seasonDay
                                + "\",\"pricePerNight\":4500,\"priority\":1}"))
                .andExpect(status().isCreated());
        mockMvc.perform(get("/api/hotel-manager/hotels/" + hotel + "/inventory?from=" + seasonDay.minusDays(1) + "&to="
                        + seasonDay).with(manager(managerId)))
                .andExpect(jsonPath("$.roomTypes[0].days[0].price").value(3000.00))
                .andExpect(jsonPath("$.roomTypes[0].days[1].price").value(4500.00))
                .andExpect(jsonPath("$.roomTypes[0].days[1].freeRooms").value(4));

        // Inventory never drops below what is booked or held.
        LocalDate busy = offPeak(25);
        inventory.hold(roomType, busy, busy.plusDays(1), 3);
        mockMvc.perform(put("/api/hotel-manager/hotels/" + hotel + "/inventory").with(manager(managerId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"roomTypeId\":\"" + roomType + "\",\"from\":\"" + busy + "\",\"to\":\"" + busy.plusDays(2)
                                + "\",\"totalRooms\":2}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVENTORY_BELOW_RESERVED"))
                .andExpect(jsonPath("$.details.nights[0]").value(busy.toString()));
        mockMvc.perform(put("/api/hotel-manager/hotels/" + hotel + "/room-types/" + roomType).with(manager(managerId))
                        .contentType(MediaType.APPLICATION_JSON).content(roomTypeJson("Harbour Double", 2, 0L)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVENTORY_BELOW_RESERVED"));
        mockMvc.perform(put("/api/hotel-manager/hotels/" + hotel + "/inventory").with(manager(managerId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"roomTypeId\":\"" + roomType + "\",\"from\":\"" + busy.plusDays(1) + "\",\"to\":\""
                                + busy.plusDays(2) + "\",\"stopSell\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roomTypes[0].days[0].stopSell").value(true))
                .andExpect(jsonPath("$.roomTypes[0].days[0].freeRooms").value(0));

        // Photos: re-encoded, first one becomes the cover, served publicly.
        String image = mockMvc.perform(multipart("/api/hotel-manager/hotels/" + hotel + "/images")
                        .file(new MockMultipartFile("file", "front.png", "image/png", png(2000, 1000)))
                        .param("caption", "Front").with(manager(managerId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.cover").value(true))
                .andExpect(jsonPath("$.width").value(1600))
                .andReturn().getResponse().getContentAsString();
        mockMvc.perform(get((String) JsonPath.read(image, "$.thumbUrl")))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_JPEG));

        // Now publishable; once indexed (normally triggered by HotelCatalogChanged) it is found by search.
        mockMvc.perform(patch("/api/admin/hotels/" + hotel + "/status").with(admin())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'hotel' AND aggregate_id = :id")
                .param("id", hotel.toString()).query(Long.class).single()).isGreaterThan(3);
        indexer.reindex(hotel);

        LocalDate checkIn = offPeak(30);
        mockMvc.perform(get("/api/hotels/search?destination=Testpur&checkIn=" + checkIn + "&checkOut=" + checkIn.plusDays(1)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].name").value("Lighthouse Inn"))
                .andExpect(jsonPath("$.content[0].demo").value(false))
                .andExpect(jsonPath("$.content[0].pricePerNight").value(3000.00));
    }

    // ------------------------------------------------------------------ helpers

    private UUID knownManager() {
        UUID id = UUID.randomUUID();
        users.upsert(new KnownUser(id, "mgr-" + id + "@example.com", "Ravi", "Kumar", Set.of("HOTEL_MANAGER"), "ACTIVE"),
                Instant.now());
        return id;
    }

    private void assignByAdmin(UUID hotel, UUID managerId) throws Exception {
        mockMvc.perform(post("/api/admin/hotels/" + hotel + "/managers").with(admin())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"MGR-" + managerId + "@example.com\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].userId", hasItem(managerId.toString())));
    }

    private static String roomTypeJson(String name, int totalRooms, Long version) {
        return """
                {"name":"%s","maxAdults":2,"maxChildren":1,"bedConfiguration":"1 Queen bed","sizeSqm":24,
                 "totalRooms":%d,"status":"ACTIVE","sortOrder":0,"amenities":["AIR_CONDITIONING","TV"],"version":%s}"""
                .formatted(name, totalRooms, version);
    }

    private static String profileJson(String amenities, int version) {
        return """
                {"name":"Lighthouse Inn","description":"Small harbour hotel.","propertyType":"HOTEL","starRating":3,
                 "addressLine":"1 Harbour Road","city":"Testpur","countryCode":"IN","latitude":15.1,"longitude":73.9,
                 "checkInTime":"13:00","checkOutTime":"11:00","amenities":%s,
                 "policies":[{"type":"PETS","description":"No pets."}],"version":%d}""".formatted(amenities, version);
    }

    private static byte[] png(int width, int height) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), "png", bytes);
        return bytes.toByteArray();
    }
}
