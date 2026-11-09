package com.flighthotel.mcpserver.tools;

import static com.flighthotel.common.security.Roles.CUSTOMER;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.flighthotel.mcpserver.gateway.GatewayClient;
import com.flighthotel.mcpserver.security.Caller;

import tools.jackson.databind.JsonNode;

/** Public catalogue for customers: hotel search and details, flight search, current offers. */
@Component
public class CatalogTools implements ToolSet {

    static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final int MAX_RESULTS = 5;

    private final GatewayClient gateway;
    private final Clock clock;

    public CatalogTools(GatewayClient gateway, Clock clock) {
        this.gateway = gateway;
        this.clock = clock;
    }

    @Override
    public List<ToolDefinition> tools() {
        return List.of(searchHotels(), hotelDetails(), searchFlights(), currentOffers());
    }

    private ToolDefinition searchHotels() {
        return ToolDefinition.named("search_hotels")
                .title("Hotel search")
                .description("Find available hotels in a city for given dates, cheapest or best first (top 5).")
                .roles(CUSTOMER)
                .param(Param.text("destination", "City or hotel name, e.g. Goa", 2, 100).required())
                .param(Param.date("checkIn", "Check-in date YYYY-MM-DD").required())
                .param(Param.date("checkOut", "Check-out date YYYY-MM-DD").required())
                .param(Param.integer("adults", "Adults (default 2)", 1, 16))
                .param(Param.integer("rooms", "Rooms (default 1)", 1, 8))
                .param(Param.integer("maxPricePerNight", "Highest price per night in rupees", 1, 1_000_000))
                .param(Param.oneOf("sort", "Order (default RECOMMENDED)",
                        List.of("RECOMMENDED", "PRICE_ASC", "PRICE_DESC", "RATING_DESC", "STARS_DESC")))
                .handler((args, caller) -> {
                    LocalDate checkIn = args.date("checkIn");
                    LocalDate checkOut = args.date("checkOut");
                    LocalDate today = LocalDate.now(clock.withZone(INDIA));
                    if (checkIn.isBefore(today)) {
                        throw new ToolInputException("checkIn", "must be today or later");
                    }
                    if (!checkOut.isAfter(checkIn) || checkIn.plusDays(30).isBefore(checkOut)) {
                        throw new ToolInputException("checkOut", "must be 1 to 30 nights after checkIn");
                    }
                    int rooms = args.integer("rooms", 1);
                    int adults = Math.max(args.integer("adults", 2), rooms);
                    Map<String, Object> query = new LinkedHashMap<>();
                    query.put("destination", args.text("destination"));
                    query.put("checkIn", checkIn);
                    query.put("checkOut", checkOut);
                    query.put("rooms", rooms);
                    query.put("adults", adults);
                    query.put("children", 0);
                    query.put("maxPrice", args.integer("maxPricePerNight"));
                    query.put("sort", args.text("sort", "RECOMMENDED"));
                    query.put("size", MAX_RESULTS);
                    JsonNode page = gateway.get(caller, "/api/hotels/search", query);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("destination", Out.text(page.path("destination"), "city") != null
                            ? Out.text(page.path("destination"), "city") : args.text("destination"));
                    out.put("checkIn", checkIn.toString());
                    out.put("checkOut", checkOut.toString());
                    out.put("nights", Out.scalar(page.get("nights")));
                    out.put("found", Out.total(page));
                    out.put("hotels", Out.rows(Out.content(page), MAX_RESULTS, hotel -> {
                        String currency = Out.currency(hotel);
                        Map<String, Object> view = Out.pick(hotel, "name", "slug", "city", "propertyType",
                                "starRating", "guestRating", "reviewCount", "available", "cheapestRoomType",
                                "freeCancellation", "breakfastIncluded", "distanceKm");
                        Out.money(view, "pricePerNight", hotel, "pricePerNight", currency);
                        Out.money(view, "totalPrice", hotel, "totalPrice", currency);
                        return view;
                    }));
                    out.put("bookingHint", "Prices include all nights and rooms with GST in totalPrice. To book, "
                            + "open the hotel page in the app.");
                    return out;
                });
    }

    private ToolDefinition hotelDetails() {
        return ToolDefinition.named("hotel_details")
                .title("Hotel details")
                .description("Description, amenities, check-in and check-out times, policies and room types of one "
                        + "hotel, by its slug from search_hotels.")
                .roles(CUSTOMER)
                .param(Param.code("hotel", "Hotel slug from search_hotels, e.g. sea-breeze-resort-goa",
                        "[A-Z0-9][A-Z0-9-]{1,119}", "sea-breeze-resort-goa").required())
                .handler((args, caller) -> {
                    String slug = args.text("hotel").toLowerCase(Locale.ROOT);
                    JsonNode hotel;
                    try {
                        hotel = gateway.get(caller, "/api/hotels/{slug}", Map.of("slug", slug), Map.of());
                    } catch (com.flighthotel.mcpserver.gateway.DownstreamException ex) {
                        if (ex.kind() == com.flighthotel.mcpserver.gateway.DownstreamException.Kind.NOT_FOUND_OR_NOT_ALLOWED) {
                            throw new ToolFailure("NOT_FOUND", "No published hotel with that name was found. "
                                    + "Use search_hotels first.");
                        }
                        throw ex;
                    }
                    Map<String, Object> out = Out.pick(hotel, "name", "slug", "propertyType", "starRating",
                            "guestRating", "reviewCount", "addressLine", "city", "checkInTime", "checkOutTime");
                    Out.put(out, "description", Out.shorten(Out.text(hotel, "description"), 400));
                    List<String> amenities = new ArrayList<>();
                    for (JsonNode amenity : hotel.path("amenities")) {
                        String name = amenity.isString() ? amenity.stringValue() : Out.text(amenity, "name");
                        if (name != null && amenities.size() < 15) {
                            amenities.add(name);
                        }
                    }
                    Out.put(out, "amenities", amenities);
                    Out.put(out, "policies", Out.rows(hotel.path("policies"), 6, policy -> Out.map(
                            "type", Out.text(policy, "type"),
                            "text", Out.shorten(Out.text(policy, "description"), 160))));
                    Out.put(out, "roomTypes", Out.rows(hotel.path("roomTypes"), 8, room -> Out.pick(room, "name",
                            "maxAdults", "maxChildren", "bedConfiguration", "sizeSqm")));
                    return out;
                });
    }

    private ToolDefinition searchFlights() {
        return ToolDefinition.named("search_flights")
                .title("Flight search")
                .description("Find flights between two airports on a date (cheapest 5). origin and destination "
                        + "may be IATA codes (DEL, BOM) or city names.")
                .roles(CUSTOMER)
                .param(Param.text("origin", "From: IATA code or city, e.g. DEL or Delhi", 3, 40).required())
                .param(Param.text("destination", "To: IATA code or city, e.g. GOI or Goa", 3, 40).required())
                .param(Param.date("departureDate", "Departure date YYYY-MM-DD").required())
                .param(Param.date("returnDate", "Return date YYYY-MM-DD for a round trip"))
                .param(Param.integer("adults", "Adults (default 1)", 1, 9))
                .param(Param.oneOf("cabin", "Cabin (default ECONOMY)",
                        List.of("ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST")))
                .param(Param.integer("maxStops", "0 = non-stop only", 0, 2))
                .handler((args, caller) -> {
                    LocalDate departure = args.date("departureDate");
                    LocalDate today = LocalDate.now(clock.withZone(INDIA));
                    if (departure.isBefore(today)) {
                        throw new ToolInputException("departureDate", "must be today or later");
                    }
                    LocalDate returnDate = args.date("returnDate");
                    if (returnDate != null && returnDate.isBefore(departure)) {
                        throw new ToolInputException("returnDate", "must not be before departureDate");
                    }
                    String origin = airport(caller, args.text("origin"), "origin");
                    String destination = airport(caller, args.text("destination"), "destination");
                    if (origin.equals(destination)) {
                        throw new ToolInputException("destination", "must differ from origin");
                    }
                    Map<String, Object> query = new LinkedHashMap<>();
                    query.put("origin", origin);
                    query.put("destination", destination);
                    query.put("departureDate", departure);
                    query.put("returnDate", returnDate);
                    query.put("adults", args.integer("adults", 1));
                    query.put("cabin", args.text("cabin", "ECONOMY"));
                    query.put("maxStops", args.integer("maxStops"));
                    query.put("sort", "PRICE_ASC");
                    JsonNode result = gateway.get(caller, "/api/flights/search", query);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("tripType", Out.text(result, "tripType"));
                    out.put("cabin", Out.text(result, "cabin"));
                    out.put("outbound", direction(result.path("outbound")));
                    if (result.path("inbound").isObject()) {
                        out.put("inbound", direction(result.path("inbound")));
                    }
                    out.put("bookingHint", "totalPrice is for all passengers incl. taxes. To book, use the flight "
                            + "search page in the app.");
                    return out;
                });
    }

    private Map<String, Object> direction(JsonNode direction) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", Out.text(direction.path("origin"), "city") + " (" + Out.text(direction.path("origin"),
                "iataCode") + ")");
        out.put("to", Out.text(direction.path("destination"), "city") + " (" + Out.text(direction.path("destination"),
                "iataCode") + ")");
        out.put("date", Out.text(direction, "date"));
        out.put("options", Out.scalar(direction.get("totalOptions")));
        out.put("flights", Out.rows(direction.path("options"), MAX_RESULTS, option -> {
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("airline", Out.text(option.path("airline"), "name"));
            view.putAll(Out.pick(option, "flightNumber", "departureLocal", "arrivalLocal", "durationMinutes",
                    "stops", "viaAirport", "seatsLeft"));
            Out.put(view, "fare", Out.text(option.path("fare"), "name"));
            Out.put(view, "refundable", Out.scalar(option.path("fare").get("refundable")));
            Out.money(view, "totalPrice", option, "totalPrice", Out.currency(option));
            return view;
        }));
        return out;
    }

    /** An IATA code as given, or the best airport match for a city name. */
    private String airport(Caller caller, String value, String field) {
        String upper = value.toUpperCase(Locale.ROOT);
        if (upper.matches("[A-Z]{3}")) {
            return upper;
        }
        JsonNode matches = gateway.get(caller, "/api/airports/search", Map.of("q", value, "limit", 1));
        if (matches.isArray() && !matches.isEmpty()) {
            String code = Out.text(matches.get(0), "iataCode");
            if (code != null) {
                return code;
            }
        }
        throw new ToolFailure("NOT_FOUND", "No airport was found for the " + field + " given. Use a city name or a "
                + "3-letter airport code.");
    }

    private ToolDefinition currentOffers() {
        return ToolDefinition.named("current_offers")
                .title("Current offers")
                .description("Active offers and their coupon codes.")
                .roles(CUSTOMER)
                .handler((args, caller) -> {
                    JsonNode offers = gateway.get(caller, "/api/offers", Map.of());
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("offers", Out.rows(offers, 8, offer -> Out.pick(offer, "title", "couponCode",
                            "discountLabel", "appliesTo", "destinationCity", "validTo")));
                    return out;
                });
    }
}
