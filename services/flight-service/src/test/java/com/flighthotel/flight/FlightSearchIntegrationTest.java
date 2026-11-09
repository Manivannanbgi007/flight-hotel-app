package com.flighthotel.flight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import com.jayway.jsonpath.JsonPath;

/** Airports, search with every filter, sorting, facets, round trips and the revalidate step. */
class FlightSearchIntegrationTest extends FlightIntegrationTest {

    /**
     * A Monday 18 to 24 days ahead: some demo flights only fly on Monday, Wednesday, Friday and Sunday, so a search
     * that expects every DEL to BOM flight must not depend on the weekday the tests run. (No other test changes the
     * seats of those days; 26 to 54 days ahead are used by tests that sell or hold seats.)
     */
    private static final int ALL_FLIGHTS = 18 + (8 - date(18).getDayOfWeek().getValue()) % 7;

    private String base(int days) {
        return "origin=DEL&destination=BOM&departureDate=" + date(days) + "&adults=1";
    }

    // ------------------------------------------------------------------ airports

    @Test
    void airportAutocompleteFindsByCodeCityAndName() throws Exception {
        mockMvc.perform(get("/api/airports/search?q=del")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].iataCode").value("DEL"))
                .andExpect(jsonPath("$[0].label").value("Delhi (DEL) · Indira Gandhi International"));
        mockMvc.perform(get("/api/airports/search?q=mum")).andExpect(jsonPath("$[0].iataCode").value("BOM"));
        mockMvc.perform(get("/api/airports/search?q=changi")).andExpect(jsonPath("$[0].iataCode").value("SIN"));
        mockMvc.perform(get("/api/airports/search?q=zzzz")).andExpect(jsonPath("$.length()").value(0));
        mockMvc.perform(get("/api/flights/airlines")).andExpect(jsonPath("$[?(@.code=='AI')].name").value("Air India"));
    }

    @Test
    void theFullAirportListIsPublicAndSortedByCityThenCode() throws Exception {
        long airports = jdbcClient.sql("SELECT COUNT(*) FROM airports").query(Long.class).single();
        assertThat(airports).isGreaterThan(1);

        // No token: public like the autocomplete (the exact path, not only /api/airports/**).
        String body = mockMvc.perform(get("/api/airports")).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value((int) airports))
                .andExpect(jsonPath("$[?(@.iataCode=='DEL')].label")
                        .value("Delhi (DEL) · Indira Gandhi International"))
                .andReturn().getResponse().getContentAsString();

        List<Map<String, Object>> rows = JsonPath.read(body, "$");
        assertThat(rows).isSortedAccordingTo(Comparator.comparing((Map<String, Object> row) -> (String) row.get("city"))
                .thenComparing(row -> (String) row.get("iataCode")));
        assertThat(rows).extracting(row -> row.get("iataCode")).doesNotHaveDuplicates();
        assertThat(rows).allSatisfy(row -> assertThat(row).containsKeys("name", "countryCode", "label"));
    }

    // ------------------------------------------------------------------ search

    @Test
    void searchShowsDemoFlightsWithTimesBaggageFareRulesAndPrices() throws Exception {
        String found = search(base(ALL_FLIGHTS));

        assertThat((Integer) JsonPath.read(found, "$.outbound.totalOptions")).isGreaterThanOrEqualTo(4);
        assertThat((Boolean) JsonPath.read(found, "$.demo")).isTrue();
        assertThat((String) JsonPath.read(found, "$.tripType")).isEqualTo("ONE_WAY");
        assertThat(found).contains("\"inbound\":null");
        assertThat((String) JsonPath.read(found, "$.outbound.origin.city")).isEqualTo("Delhi");
        assertThat((String) JsonPath.read(found, "$.outbound.options[0].airline.name")).isNotBlank();
        assertThat((String) JsonPath.read(found, "$.outbound.options[0].departureLocal")).startsWith(date(ALL_FLIGHTS).toString());
        assertThat((Integer) JsonPath.read(found, "$.outbound.options[0].durationMinutes")).isBetween(90, 400);
        assertThat((Boolean) JsonPath.read(found, "$.outbound.options[0].demo")).isTrue();
        assertThat((String) JsonPath.read(found, "$.outbound.options[0].expiresAt")).isNotBlank();
        // Both fare families of a flight are offered: the cheaper non-refundable and the flexible one.
        List<String> types = JsonPath.read(found, "$.outbound.options[*].fare.type");
        assertThat(types).contains("NON_REFUNDABLE", "REFUNDABLE");
        List<String> policies = JsonPath.read(found, "$.outbound.options[?(@.fare.refundable==true)].fare.cancellationPolicy");
        assertThat(policies.getFirst()).contains("fee of 25%");
        assertThat((Integer) JsonPath.read(found, "$.outbound.options[0].fare.checkedBaggageKg")).isEqualTo(15);
        assertThat(JsonPath.<Integer>read(found, "$.outbound.options[0].seatsLeft")).isBetween(1, 9);
    }

    @Test
    void resultsAreSortedByPriceAndOtherOrdersAreAvailable() throws Exception {
        List<Number> byPrice = JsonPath.read(search(base(ALL_FLIGHTS)), "$.outbound.options[*].totalPrice");
        assertThat(byPrice).isSortedAccordingTo((a, b) -> Double.compare(a.doubleValue(), b.doubleValue()));

        List<Integer> byDuration = JsonPath.read(search(base(ALL_FLIGHTS) + "&sort=DURATION_ASC"),
                "$.outbound.options[*].durationMinutes");
        assertThat(byDuration).isSorted();
        List<String> byDeparture = JsonPath.read(search(base(ALL_FLIGHTS) + "&sort=DEPARTURE_ASC"),
                "$.outbound.options[*].departureLocal");
        assertThat(byDeparture).isSorted();
        List<String> byArrival = JsonPath.read(search(base(ALL_FLIGHTS) + "&sort=ARRIVAL_ASC"),
                "$.outbound.options[*].arrivalLocal");
        assertThat(byArrival).isSorted();
    }

    @Test
    void everyFilterNarrowsTheResultsAndTheFacetsStillCountEverything() throws Exception {
        String all = search(base(ALL_FLIGHTS));
        int total = JsonPath.read(all, "$.outbound.totalOptions");

        String refundable = search(base(ALL_FLIGHTS) + "&refundable=true");
        List<Boolean> flags = JsonPath.read(refundable, "$.outbound.options[*].fare.refundable");
        assertThat(flags).isNotEmpty().containsOnly(true);
        assertThat((Integer) JsonPath.read(refundable, "$.outbound.totalOptions")).isEqualTo(total);
        assertThat((Integer) JsonPath.read(refundable, "$.facets.refundable.no")).isPositive();

        String airline = JsonPath.read(all, "$.outbound.options[0].airline.code");
        List<String> airlines = JsonPath.read(search(base(ALL_FLIGHTS) + "&airlines=" + airline), "$.outbound.options[*].airline.code");
        assertThat(airlines).isNotEmpty().containsOnly(airline);

        List<Integer> stops = JsonPath.read(search(base(ALL_FLIGHTS) + "&maxStops=0"), "$.outbound.options[*].stops");
        assertThat(stops).containsOnly(0);

        Number cheapest = JsonPath.read(all, "$.facets.minPrice");
        List<Number> cheap = JsonPath.read(search(base(ALL_FLIGHTS) + "&maxPrice=" + (cheapest.intValue() + 500)),
                "$.outbound.options[*].totalPrice");
        assertThat(cheap).isNotEmpty().allMatch(price -> price.doubleValue() <= cheapest.doubleValue() + 500);

        List<String> morning = JsonPath.read(search(base(ALL_FLIGHTS) + "&departBefore=12:00"), "$.outbound.options[*].departureLocal");
        assertThat(morning).allMatch(time -> time.substring(11).compareTo("12:00") <= 0);
        List<String> evening = JsonPath.read(search(base(ALL_FLIGHTS) + "&departAfter=12:00"), "$.outbound.options[*].departureLocal");
        assertThat(evening).allMatch(time -> time.substring(11).compareTo("12:00") >= 0);
        assertThat(morning.size() + evening.size()).isGreaterThanOrEqualTo(total);

        List<String> arrivals = JsonPath.read(search(base(ALL_FLIGHTS) + "&arriveBefore=23:59&arriveAfter=00:00"),
                "$.outbound.options[*].arrivalLocal");
        assertThat(arrivals).hasSize(total);

        Integer shortest = JsonPath.read(all, "$.outbound.options[0].durationMinutes");
        List<Integer> durations = JsonPath.read(search(base(ALL_FLIGHTS) + "&maxDurationMinutes=" + (shortest + 30)),
                "$.outbound.options[*].durationMinutes");
        assertThat(durations).allMatch(minutes -> minutes <= shortest + 30);

        assertThat((Integer) JsonPath.read(search(base(ALL_FLIGHTS) + "&maxPrice=1"), "$.outbound.options.length()")).isZero();
        assertThat((String) JsonPath.read(all, "$.facets.airlines[0].name")).isNotBlank();
        assertThat((Integer) JsonPath.read(all, "$.facets.stops[0].count")).isPositive();
    }

    @Test
    void cabinsAndFaresDifferInPriceAndAvailability() throws Exception {
        Number economy = JsonPath.read(search(base(ALL_FLIGHTS)), "$.facets.minPrice");
        Number business = JsonPath.read(search(base(ALL_FLIGHTS) + "&cabin=BUSINESS"), "$.facets.minPrice");
        assertThat(business.doubleValue()).isGreaterThan(economy.doubleValue() * 2.5);
        // A cabin nobody flies on this route (First on a domestic flight) has no options, not an error.
        assertThat((Integer) JsonPath.read(search(base(ALL_FLIGHTS) + "&cabin=FIRST"), "$.outbound.totalOptions")).isZero();
    }

    @Test
    void childrenAndInfantsAreChargedDifferentlyAndInfantsNeedNoSeat() throws Exception {
        String one = revalidate(offerId(search(base(ALL_FLIGHTS)), "outbound", 0));
        String family = search("origin=DEL&destination=BOM&departureDate=" + date(ALL_FLIGHTS) + "&adults=2&children=1&infants=1");
        String trip = revalidate(offerId(family, "outbound", 0));

        List<String> labels = JsonPath.read(trip, "$.priceLines[*].label");
        assertThat(labels).contains("Fare · 2 adults", "Fare · 1 child", "Fare · 1 infant",
                "Fuel and airport charges", "GST 5%");
        assertThat(JsonPath.<Number>read(trip, "$.total").doubleValue())
                .isGreaterThan(JsonPath.<Number>read(one, "$.total").doubleValue() * 2.5);
        assertThat((Integer) JsonPath.read(trip, "$.passengers.infants")).isEqualTo(1);
    }

    @Test
    void roundTripSearchHasBothDirections() throws Exception {
        String found = search("origin=DEL&destination=BOM&departureDate=" + date(ALL_FLIGHTS) + "&returnDate=" + date(ALL_FLIGHTS + 5)
                + "&adults=1");

        assertThat((String) JsonPath.read(found, "$.tripType")).isEqualTo("ROUND_TRIP");
        assertThat((String) JsonPath.read(found, "$.inbound.origin.iataCode")).isEqualTo("BOM");
        assertThat((String) JsonPath.read(found, "$.inbound.destination.iataCode")).isEqualTo("DEL");
        assertThat((String) JsonPath.read(found, "$.inbound.options[0].departureLocal")).startsWith(date(ALL_FLIGHTS + 5).toString());
        assertThat((Integer) JsonPath.read(found, "$.inboundFacets.airlines.length()")).isPositive();
    }

    @Test
    void internationalFlightsHaveStopsAndHigherCharges() throws Exception {
        String found = search("origin=DEL&destination=LHR&departureDate=" + date(40) + "&adults=1");
        String trip = revalidate(offerId(found, "outbound", 0));

        assertThat((Boolean) JsonPath.read(trip, "$.international")).isTrue();
        List<Number> charges = JsonPath.read(trip, "$.priceLines[?(@.label=='Fuel and airport charges')].amount");
        assertThat(charges.getFirst().doubleValue()).isEqualTo(1600.0);
        // Some flights to London connect: their segments show the layover.
        List<Integer> stops = JsonPath.read(found, "$.outbound.options[*].stops");
        assertThat(stops).isNotEmpty();
    }

    @Test
    void invalidSearchesAreRefusedWithReasons() throws Exception {
        mockMvc.perform(get("/api/flights/search?origin=DEL&destination=DEL&departureDate=" + date(5)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("SAME_AIRPORT"));
        mockMvc.perform(get("/api/flights/search?origin=DEL&destination=ZZZ&departureDate=" + date(5)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("UNKNOWN_AIRPORT"));
        mockMvc.perform(get("/api/flights/search?origin=DEL&destination=BOM&departureDate=" + date(-1)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_DATE"));
        mockMvc.perform(get("/api/flights/search?origin=DEL&destination=BOM&departureDate=" + date(400)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_DATE"));
        mockMvc.perform(get("/api/flights/search?origin=DEL&destination=BOM&departureDate=" + date(10)
                        + "&returnDate=" + date(5))).andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/flights/search?origin=DEL&destination=BOM&departureDate=" + date(5)
                        + "&adults=1&infants=2")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PASSENGERS"));
        mockMvc.perform(get("/api/flights/search?origin=DEL&destination=BOM&departureDate=" + date(5)
                        + "&adults=6&children=4")).andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/flights/search?origin=DEL&destination=BOM&departureDate=" + date(5) + "&cabin=LUXURY"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_CABIN"));
        mockMvc.perform(get("/api/flights/search?origin=DEL&destination=BOM&departureDate=" + date(5)
                        + "&departAfter=late")).andExpect(status().isBadRequest());
    }

    @Test
    void popularRoutesShowTheirLowestFare() throws Exception {
        mockMvc.perform(get("/api/flights/popular-routes")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].origin.iataCode").exists())
                .andExpect(jsonPath("$[0].fromPrice").isNumber());
    }

    // ------------------------------------------------------------------ revalidate

    @Test
    void revalidatingPricesTheTripAgainWithoutReservingAnything() throws Exception {
        String found = search(base(26));
        String trip = revalidate(offerId(found, "outbound", 0));

        assertThat((Boolean) JsonPath.read(trip, "$.priceChanged")).isFalse();
        assertThat(JsonPath.<Number>read(trip, "$.total").doubleValue())
                .isEqualTo(JsonPath.<Number>read(found, "$.outbound.options[0].totalPrice").doubleValue());
        assertThat((String) JsonPath.read(trip, "$.title")).isEqualTo("Delhi to Mumbai");
        assertThat((Boolean) JsonPath.read(trip, "$.international")).isFalse();
        assertThat((Boolean) JsonPath.read(trip, "$.demo")).isTrue();
        assertThat((Integer) JsonPath.read(trip, "$.slices.length()")).isEqualTo(1);
        assertThat(seatsOf(trip, 0)).containsExactly(0, 0);
        // The same trip can be read again by its id (the passenger page reloads).
        mockMvc.perform(get("/api/flights/trips/" + JsonPath.read(trip, "$.tripOfferId")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(JsonPath.<Number>read(trip, "$.total")));
    }

    @Test
    void aRoundTripIsPricedAsTheSumOfBothFlights() throws Exception {
        String found = search("origin=DEL&destination=BOM&departureDate=" + date(26) + "&returnDate=" + date(30)
                + "&adults=1");
        String trip = revalidate(offerId(found, "outbound", 0), offerId(found, "inbound", 0));

        double expected = JsonPath.<Number>read(found, "$.outbound.options[0].totalPrice").doubleValue()
                + JsonPath.<Number>read(found, "$.inbound.options[0].totalPrice").doubleValue();
        assertThat(JsonPath.<Number>read(trip, "$.total").doubleValue()).isEqualTo(expected);
        assertThat((String) JsonPath.read(trip, "$.tripType")).isEqualTo("ROUND_TRIP");
        assertThat((Integer) JsonPath.read(trip, "$.slices.length()")).isEqualTo(2);
        assertThat((String) JsonPath.read(trip, "$.cancellationPolicy")).contains("Outbound:").contains("Return:");
    }

    @Test
    void offersThatDoNotBelongTogetherOrHaveExpiredAreRefused() throws Exception {
        String found = search("origin=DEL&destination=BOM&departureDate=" + date(26) + "&returnDate=" + date(30)
                + "&adults=1");
        String out = offerId(found, "outbound", 0);
        String out2 = offerId(found, "outbound", 1);
        String in = offerId(found, "inbound", 0);

        mockMvc.perform(post("/api/flights/revalidate").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"offerIds\":[\"" + out + "\",\"" + out2 + "\"]}"))
                .andExpect(status().isUnprocessableContent()).andExpect(jsonPath("$.code").value("INVALID_OFFERS"));
        mockMvc.perform(post("/api/flights/revalidate").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"offerIds\":[\"" + in + "\",\"" + out + "\"]}"))
                .andExpect(status().isUnprocessableContent());
        mockMvc.perform(post("/api/flights/revalidate").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"offerIds\":[\"" + UUID.randomUUID() + "\"]}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("OFFER_EXPIRED"));
        mockMvc.perform(post("/api/flights/revalidate").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"offerIds\":[]}")).andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/flights/trips/" + UUID.randomUUID())).andExpect(status().isNotFound());
    }

    @Test
    void aFlightThatSoldOutSinceTheSearchCannotBeSelected() throws Exception {
        String found = search(base(27));
        String offer = offerId(found, "outbound", 0);
        String trip = revalidate(offer);
        // Someone else takes every economy seat of that flight meanwhile.
        jdbcClient.sql("INSERT IGNORE INTO demo_seat_inventory (id, schedule_id, flight_date, cabin, seats_total) "
                        + "SELECT UUID_TO_BIN(UUID()), s.id, :d, 'ECONOMY', 150 FROM demo_flight_schedules s "
                        + "WHERE s.origin = 'DEL' AND s.destination = 'BOM'")
                .param("d", java.sql.Date.valueOf(date(27))).update();
        jdbcClient.sql("UPDATE demo_seat_inventory SET seats_sold = seats_total WHERE cabin = 'ECONOMY' "
                + "AND flight_date = :d").param("d", java.sql.Date.valueOf(date(27))).update();
        mockMvc.perform(post("/api/flights/revalidate").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"offerIds\":[\"" + offer + "\"]}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SOLD_OUT"));
        assertThat(trip).isNotBlank();
    }

    @Test
    void aPriceThatRoseSinceTheSearchIsFlaggedForTheCustomerToAccept() throws Exception {
        String found = search(base(28));
        String offer = offerId(found, "outbound", 0);
        BigDecimal searched = new BigDecimal(String.valueOf((Object) JsonPath.read(found, "$.outbound.options[0].totalPrice")));
        // The flight fills up (60 % sold) after the search: the same fare costs more now.
        jdbcClient.sql("INSERT IGNORE INTO demo_seat_inventory (id, schedule_id, flight_date, cabin, seats_total, seats_sold) "
                        + "SELECT UUID_TO_BIN(UUID()), s.id, :d, 'ECONOMY', 150, 90 FROM demo_flight_schedules s "
                        + "WHERE s.origin = 'DEL' AND s.destination = 'BOM'")
                .param("d", java.sql.Date.valueOf(date(28))).update();
        jdbcClient.sql("UPDATE demo_seat_inventory SET seats_sold = 90 WHERE cabin = 'ECONOMY' AND flight_date = :d")
                .param("d", java.sql.Date.valueOf(date(28))).update();

        String trip = revalidate(offer);

        assertThat((Boolean) JsonPath.read(trip, "$.priceChanged")).isTrue();
        assertThat(new BigDecimal(String.valueOf((Object) JsonPath.read(trip, "$.previousTotal"))))
                .isEqualByComparingTo(searched);
        assertThat(JsonPath.<Number>read(trip, "$.total").doubleValue()).isGreaterThan(searched.doubleValue());
    }

    // ------------------------------------------------------------------ Flight Provider Management

    @Test
    void adminsManageProvidersAndSearchSaysTemporarilyUnavailableWhenNoneIsEnabled() throws Exception {
        mockMvc.perform(get("/api/admin/flight-providers").with(customer())).andExpect(status().isForbidden());
        mockMvc.perform(get("/api/admin/flight-providers")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/admin/flight-providers").with(admin())).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].code").value("DEMO")).andExpect(jsonPath("$[0].demo").value(true))
                .andExpect(jsonPath("$[0].enabled").value(true));
        mockMvc.perform(post("/api/admin/flight-providers/DEMO/health-check").with(admin()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.healthStatus").value("UP"));

        mockMvc.perform(patch("/api/admin/flight-providers/DEMO").with(admin()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":false}")).andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(false));
        mockMvc.perform(get("/api/flights/search?" + base(ALL_FLIGHTS))).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("FLIGHT_SEARCH_UNAVAILABLE"));
        mockMvc.perform(patch("/api/admin/flight-providers/DEMO").with(admin()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":true,\"priority\":1}")).andExpect(status().isOk());
        mockMvc.perform(get("/api/flights/search?" + base(ALL_FLIGHTS))).andExpect(status().isOk());
        mockMvc.perform(patch("/api/admin/flight-providers/NOPE").with(admin()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":true}")).andExpect(status().isNotFound());
    }
}
