package com.flighthotel.hotel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.lessThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import com.jayway.jsonpath.JsonPath;

/**
 * Phase 4 exit check "search filter tests": every filter of requirement §10 against the indexed demo catalogue
 * (Goa: Sea Breeze Resort 4★ resort, Palm Grove Villas 5★ villa, Panjim Heritage Inn 3★ guest house).
 */
class HotelSearchIntegrationTest extends HotelIntegrationTest {

    private static final String SEA_BREEZE = "Sea Breeze Resort";
    private static final String PALM_GROVE = "Palm Grove Villas";
    private static final String PANJIM = "Panjim Heritage Inn";

    private ResultActions search(String query) throws Exception {
        LocalDate checkIn = offPeak(30);
        return mockMvc.perform(get("/api/hotels/search?destination=Goa&checkIn=" + checkIn + "&checkOut="
                + checkIn.plusDays(2) + query));
    }

    @Test
    void findsEveryAvailableHotelOfTheDestination() throws Exception {
        search("&adults=2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.nights").value(2))
                .andExpect(jsonPath("$.content[*].name", containsInAnyOrder(SEA_BREEZE, PALM_GROVE, PANJIM)))
                .andExpect(jsonPath("$.content[*].available", everyItem(org.hamcrest.Matchers.is(true))))
                .andExpect(jsonPath("$.content[*].demo", everyItem(org.hamcrest.Matchers.is(true))))
                .andExpect(jsonPath("$.content[0].imageUrl").exists())
                .andExpect(jsonPath("$.destination.distanceFrom").value("Goa city centre (Panaji)"))
                .andExpect(jsonPath("$.facets.minPrice").value(2816.00))
                .andExpect(jsonPath("$.facets.maxPrice").value(16280.00));
    }

    @Test
    void toleratesTyposInTheDestination() throws Exception {
        LocalDate checkIn = offPeak(30);
        mockMvc.perform(get("/api/hotels/search?destination=Bengalru&checkIn=" + checkIn + "&checkOut=" + checkIn.plusDays(1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].city", everyItem(org.hamcrest.Matchers.is("Bengaluru"))))
                .andExpect(jsonPath("$.totalElements").value(3));
    }

    @Test
    void aKnownCityMatchesExactlyNotSimilarCities() throws Exception {
        LocalDate checkIn = offPeak(30);
        // "Jaipur" is two edits from "Udaipur": a fuzzy match would add the Udaipur hotel.
        mockMvc.perform(get("/api/hotels/search?destination=jaipur&checkIn=" + checkIn + "&checkOut=" + checkIn.plusDays(1)))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[*].city", everyItem(org.hamcrest.Matchers.is("Jaipur"))));
    }

    @Test
    void filtersByStarsPropertyTypeAndGuestRating() throws Exception {
        search("&stars=5").andExpect(jsonPath("$.content[*].name", containsInAnyOrder(PALM_GROVE)));
        search("&stars=3,4").andExpect(jsonPath("$.content[*].name", containsInAnyOrder(SEA_BREEZE, PANJIM)));
        search("&propertyTypes=GUEST_HOUSE").andExpect(jsonPath("$.content[*].name", containsInAnyOrder(PANJIM)));
        search("&minGuestRating=4.5").andExpect(jsonPath("$.content[*].name", containsInAnyOrder(PALM_GROVE)));
    }

    @Test
    void everyChosenAmenityMustBePresent() throws Exception {
        search("&amenities=POOL,SPA").andExpect(jsonPath("$.content[*].name", containsInAnyOrder(SEA_BREEZE, PALM_GROVE)));
        search("&amenities=POOL,KIDS_CLUB").andExpect(jsonPath("$.content[*].name", containsInAnyOrder(SEA_BREEZE)));
    }

    @Test
    void filtersByDistanceFromTheCityCentre() throws Exception {
        search("&maxDistanceKm=5")
                .andExpect(jsonPath("$.content[*].name", containsInAnyOrder(PANJIM)))
                .andExpect(jsonPath("$.content[0].distanceKm", lessThanOrEqualTo(5.0)));
        search("&sort=DISTANCE_ASC").andExpect(jsonPath("$.content[0].name").value(PANJIM));
    }

    @Test
    void sortsAndFiltersByPrice() throws Exception {
        // Cheapest plans are the non-refundable "Saver" rates: base price × 0.88.
        search("&sort=PRICE_ASC")
                .andExpect(jsonPath("$.content[*].name").value(org.hamcrest.Matchers.contains(PANJIM, SEA_BREEZE, PALM_GROVE)))
                .andExpect(jsonPath("$.content[0].pricePerNight").value(2816.00))
                .andExpect(jsonPath("$.content[0].cheapestRoomType").value("Heritage Double"));
        search("&sort=PRICE_DESC").andExpect(jsonPath("$.content[0].name").value(PALM_GROVE));
        search("&maxPrice=6000").andExpect(jsonPath("$.content[*].name", containsInAnyOrder(PANJIM, SEA_BREEZE)));
        search("&minPrice=10000").andExpect(jsonPath("$.content[*].name", containsInAnyOrder(PALM_GROVE)));
    }

    @Test
    void freeCancellationAndBreakfastUseOnlyMatchingPlans() throws Exception {
        // Only the "Flexible with breakfast" plan (base + 900) qualifies.
        search("&freeCancellation=true&sort=PRICE_ASC")
                .andExpect(jsonPath("$.content[0].name").value(PANJIM))
                .andExpect(jsonPath("$.content[0].pricePerNight").value(4100.00))
                .andExpect(jsonPath("$.content[0].freeCancellation").value(true));
        search("&breakfastIncluded=true&sort=PRICE_ASC")
                .andExpect(jsonPath("$.content[0].pricePerNight").value(4100.00))
                .andExpect(jsonPath("$.content[0].breakfastIncluded").value(true));
    }

    @Test
    void onlyRoomsThatFitThePartyCount() throws Exception {
        // 4 adults in one room: only the Palm Grove pool villa takes 4 adults.
        search("&adults=4&rooms=1").andExpect(jsonPath("$.content[*].name", containsInAnyOrder(PALM_GROVE)));
        // ... or two rooms anywhere.
        search("&adults=4&rooms=2").andExpect(jsonPath("$.totalElements").value(3));
        search("&adults=2&children=1&childAges=7")
                .andExpect(jsonPath("$.totalElements").value(3));
    }

    @Test
    void soldOutHotelsAreHiddenOrMarkedUnavailable() throws Exception {
        LocalDate checkIn = offPeak(150);
        for (String room : List.of("Heritage Double", "Family Room")) {
            inventory.updateNights(roomTypeId(PANJIM, room), checkIn, checkIn, null, true);
        }
        String query = "/api/hotels/search?destination=Goa&checkIn=" + checkIn + "&checkOut=" + checkIn.plusDays(2);

        mockMvc.perform(get(query))
                .andExpect(jsonPath("$.content[*].name", containsInAnyOrder(SEA_BREEZE, PALM_GROVE)));
        mockMvc.perform(get(query + "&availableOnly=false"))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.content[2].name").value(PANJIM))
                .andExpect(jsonPath("$.content[2].available").value(false))
                .andExpect(jsonPath("$.content[2].pricePerNight").doesNotExist());
    }

    @Test
    void pagesResults() throws Exception {
        search("&sort=PRICE_ASC&size=2&page=1")
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].name").value(PALM_GROVE));
    }

    @Test
    void rejectsImpossibleStays() throws Exception {
        LocalDate today = inventory.today();
        mockMvc.perform(get("/api/hotels/search?destination=Goa&checkIn=" + today.minusDays(1) + "&checkOut=" + today.plusDays(1)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_STAY"))
                .andExpect(jsonPath("$.details.field").value("checkIn"));
        mockMvc.perform(get("/api/hotels/search?destination=Goa&checkIn=" + today.plusDays(1) + "&checkOut=" + today.plusDays(40)))
                .andExpect(jsonPath("$.code").value("INVALID_STAY"));
        mockMvc.perform(get("/api/hotels/search?destination=Goa&checkIn=" + today.plusDays(1) + "&checkOut=" + today.plusDays(2)
                        + "&children=1"))
                .andExpect(jsonPath("$.details.field").value("childAges"));
        mockMvc.perform(get("/api/hotels/search?destination=G&checkIn=" + today.plusDays(1) + "&checkOut=" + today.plusDays(2)
                        + "&rooms=9"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void hotelDetailsBySlugWithNearbyPlaces() throws Exception {
        String slug = jdbcClient.sql("SELECT slug FROM hotels WHERE name = :name").param("name", SEA_BREEZE)
                .query(String.class).single();
        mockMvc.perform(get("/api/hotels/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value(SEA_BREEZE))
                .andExpect(jsonPath("$.demo").value(true))
                .andExpect(jsonPath("$.checkInTime").value("14:00:00"))
                .andExpect(jsonPath("$.amenities[*].code", hasItem("POOL")))
                .andExpect(jsonPath("$.policies.length()").value(3))
                .andExpect(jsonPath("$.images.length()").value(2))
                .andExpect(jsonPath("$.roomTypes.length()").value(2))
                .andExpect(jsonPath("$.nearby[0].name").value("Calangute Beach"));

        mockMvc.perform(get("/api/hotels/no-such-hotel"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("HOTEL_NOT_FOUND"));
    }

    @Test
    void roomsAndQuoteWithTaxes() throws Exception {
        UUID hotel = hotelId(PANJIM);
        UUID room = roomTypeId(PANJIM, "Heritage Double");
        LocalDate checkIn = offPeak(45);

        String rooms = mockMvc.perform(get("/api/hotels/" + hotel + "/rooms?checkIn=" + checkIn + "&checkOut="
                        + checkIn.plusDays(2) + "&adults=2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roomTypes[0].roomType.name").value("Heritage Double"))
                .andExpect(jsonPath("$.roomTypes[0].available").value(true))
                .andExpect(jsonPath("$.roomTypes[0].rates.length()").value(2))
                // Saver: 2816 × 2 nights = 5632 + GST 5 % (140.80 per night) = 5913.60
                .andExpect(jsonPath("$.roomTypes[0].rates[0].subtotal").value(5632.00))
                .andExpect(jsonPath("$.roomTypes[0].rates[0].taxes").value(281.60))
                .andExpect(jsonPath("$.roomTypes[0].rates[0].total").value(5913.60))
                .andExpect(jsonPath("$.roomTypes[0].rates[0].cancellationPolicy").value(
                        "Non-refundable: the full amount is charged if you cancel."))
                .andExpect(jsonPath("$.roomTypes[0].rates[1].freeCancellation").value(true))
                .andReturn().getResponse().getContentAsString();
        String flexiblePlan = JsonPath.read(rooms, "$.roomTypes[0].rates[1].ratePlanId");

        String quote = mockMvc.perform(post("/api/hotels/availability").contentType(MediaType.APPLICATION_JSON).content("""
                        {"hotelId":"%s","roomTypeId":"%s","ratePlanId":"%s",
                         "stay":{"checkIn":"%s","checkOut":"%s","rooms":1,"adults":2,"children":0}}"""
                        .formatted(hotel, room, flexiblePlan, checkIn, checkIn.plusDays(2))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.quoteId").exists())
                .andExpect(jsonPath("$.ratePlanName").value("Flexible with breakfast"))
                // 4100 × 2 = 8200 + GST 5 % = 410 → 8610
                .andExpect(jsonPath("$.subtotal").value(8200.00))
                .andExpect(jsonPath("$.taxLines[0].label").value("GST 5%"))
                .andExpect(jsonPath("$.total").value(8610.00))
                .andExpect(jsonPath("$.freeCancellationUntil").exists())
                .andExpect(jsonPath("$.demo").value(true))
                .andReturn().getResponse().getContentAsString();

        String quoteId = JsonPath.read(quote, "$.quoteId");
        mockMvc.perform(get("/api/hotels/quotes/" + quoteId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(8610.00));
        assertThat(quoteId).isNotBlank();
    }

    @Test
    void quoteRefusesTooSmallOrSoldOutRooms() throws Exception {
        UUID hotel = hotelId(PANJIM);
        UUID room = roomTypeId(PANJIM, "Heritage Double");
        LocalDate checkIn = offPeak(170);
        String plan = jdbcClient.sql("SELECT BIN_TO_UUID(id) FROM rate_plans WHERE room_type_id = UUID_TO_BIN(:room) LIMIT 1")
                .param("room", room.toString()).query(String.class).single();
        String body = """
                {"hotelId":"%s","roomTypeId":"%s","ratePlanId":"%s",
                 "stay":{"checkIn":"%s","checkOut":"%s","rooms":1,"adults":%d,"children":0}}""";

        mockMvc.perform(post("/api/hotels/availability").contentType(MediaType.APPLICATION_JSON)
                        .content(body.formatted(hotel, room, plan, checkIn, checkIn.plusDays(1), 3)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("ROOM_TOO_SMALL"));

        inventory.updateNights(room, checkIn, checkIn, 0, null);
        mockMvc.perform(post("/api/hotels/availability").contentType(MediaType.APPLICATION_JSON)
                        .content(body.formatted(hotel, room, plan, checkIn, checkIn.plusDays(1), 2)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ROOMS_NOT_AVAILABLE"));
    }

    @Test
    void destinationSuggestionsAndAmenities() throws Exception {
        mockMvc.perform(get("/api/hotels/destinations?q=ja"))
                .andExpect(jsonPath("$[0].city").value("Jaipur"))
                .andExpect(jsonPath("$[0].hotels").value(2));
        mockMvc.perform(get("/api/hotels/amenities"))
                .andExpect(jsonPath("$[?(@.code == 'POOL')].category").value("HOTEL"));
    }
}
