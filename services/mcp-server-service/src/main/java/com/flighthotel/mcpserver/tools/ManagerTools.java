package com.flighthotel.mcpserver.tools;

import static com.flighthotel.common.security.Roles.HOTEL_MANAGER;

import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.flighthotel.mcpserver.gateway.GatewayClient;
import com.flighthotel.mcpserver.security.Caller;

import tools.jackson.databind.JsonNode;

/**
 * The hotel manager's own hotels: dashboard, arrivals and departures, reservations, occupancy and revenue. Only
 * hotels assigned to the manager are reachable (hotel-service answers 403 HOTEL_NOT_ASSIGNED otherwise). Without a
 * {@code hotel} argument a tool covers every assigned hotel (at most {@value #MAX_HOTELS}).
 */
@Component
public class ManagerTools implements ToolSet {

    private static final int MAX_HOTELS = 5;
    /** Rows of guests per list: enough to answer, small enough for a quick answer on a CPU. */
    private static final int MAX_GUEST_ROWS = 15;
    private static final String BASE = "/api/hotel-manager/hotels/{hotelId}";

    private final GatewayClient gateway;
    private final Clock clock;

    public ManagerTools(GatewayClient gateway, Clock clock) {
        this.gateway = gateway;
        this.clock = clock;
    }

    @Override
    public List<ToolDefinition> tools() {
        return List.of(myHotels(), dashboard(), arrivalsDepartures(), reservations(), occupancy());
    }

    private static Param hotelParam() {
        return Param.text("hotel", "Hotel name (or part of it); leave out for all your hotels", 2, 120);
    }

    private ToolDefinition myHotels() {
        return ToolDefinition.named("my_hotels")
                .title("Your hotels")
                .description("Names of the hotels assigned to you. Not needed before the other hotel tools: "
                        + "without a hotel name they cover all your hotels.")
                .roles(HOTEL_MANAGER)
                .handler((args, caller) -> Map.of("hotels", Out.rows(hotels(caller), 20,
                        hotel -> Out.pick(hotel, "name", "city", "status", "starRating"))));
    }

    private ToolDefinition dashboard() {
        return ToolDefinition.named("hotel_dashboard")
                .title("Hotel dashboard")
                .description("Today's arrivals, departures, in-house guests and occupancy, plus reservations, "
                        + "room nights, revenue, ADR and cancellations for a period.")
                .roles(HOTEL_MANAGER)
                .param(hotelParam())
                .param(Ranges.range(Ranges.DASHBOARD_PRESETS))
                .param(Ranges.from("First day for CUSTOM, YYYY-MM-DD"))
                .param(Ranges.to("Last day for CUSTOM, YYYY-MM-DD"))
                .handler((args, caller) -> perHotel(caller, args.text("hotel"), hotel -> {
                    JsonNode dashboard = gateway.get(caller, BASE + "/dashboard", Map.of("hotelId", id(hotel)),
                            Ranges.query(args, Ranges.DASHBOARD_MAX_DAYS));
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("hotel", Out.text(hotel, "name"));
                    out.put("range", Out.pick(dashboard.path("range"), "preset", "from", "to"));
                    out.put("today", Out.pick(dashboard.path("today"), "date", "arrivals", "departures", "inHouse",
                            "arrivingGuests", "departingGuests", "inHouseGuests", "occupancyPercent"));
                    JsonNode stats = dashboard.path("stats");
                    Map<String, Object> period = Out.pick(stats, "reservations", "roomNights", "availableRoomNights",
                            "bookedRoomNights", "cancellations", "occupancyPercent");
                    Out.money(period, "revenue", stats, "revenue", "INR");
                    Out.money(period, "averageDailyRate", stats, "averageDailyRate", "INR");
                    Out.money(period, "revPar", stats, "revPar", "INR");
                    out.put("period", period);
                    Out.put(out, "rating", Out.pick(dashboard.path("ratings"), "guestRating", "reviewCount",
                            "pendingReviews"));
                    JsonNode comparison = dashboard.path("comparison");
                    if (comparison.isObject()) {
                        Map<String, Object> previous = new LinkedHashMap<>();
                        Out.put(previous, "revenue", Ranges.change(comparison.get("revenue"), true));
                        Out.put(previous, "occupancyPercent", Ranges.change(comparison.get("occupancyPercent"), false));
                        Out.put(out, "versusPreviousPeriod", previous);
                    }
                    out.put("arrivalsNext7Days", dashboard.path("upcomingArrivals").size());
                    return out;
                }));
    }

    private ToolDefinition arrivalsDepartures() {
        return ToolDefinition.named("hotel_arrivals_departures")
                .title("Arrivals and departures")
                .description("Guests arriving (check-in) or leaving (check-out) on a day (default today) at your "
                        + "hotels. kind ARRIVALS for who is arriving, DEPARTURES for who is leaving.")
                .roles(HOTEL_MANAGER)
                .param(hotelParam())
                .param(Param.oneOf("kind", "ARRIVALS, DEPARTURES or BOTH (default BOTH)",
                        List.of("ARRIVALS", "DEPARTURES", "BOTH")))
                .param(Param.date("date", "Day, YYYY-MM-DD (default today)"))
                .handler((args, caller) -> {
                    LocalDate day = args.date("date") != null ? args.date("date")
                            : LocalDate.now(clock.withZone(CatalogTools.INDIA));
                    String kind = args.text("kind", "BOTH");
                    boolean arrivalsWanted = !"DEPARTURES".equals(kind);
                    boolean departuresWanted = !"ARRIVALS".equals(kind);
                    return perHotel(caller, args.text("hotel"), hotel -> {
                        Map<String, Object> out = new LinkedHashMap<>();
                        out.put("hotel", Out.text(hotel, "name"));
                        out.put("date", day.toString());
                        StringBuilder summary = new StringBuilder();
                        if (arrivalsWanted) {
                            JsonNode arrivals = gateway.get(caller, BASE + "/reservations",
                                    Map.of("hotelId", id(hotel)), Map.of("status", "CONFIRMED,CHECKED_IN,NO_SHOW",
                                            "dateField", "CHECK_IN", "from", day, "to", day, "size", 50,
                                            "sort", "checkIn,asc"));
                            summary.append(Out.total(arrivals)).append(" arriving (check-in on ").append(day)
                                    .append(")");
                            // Each list shows only its own day, so the model cannot mix up arrivals and departures.
                            out.put("arriving", Out.rows(Out.content(arrivals), MAX_GUEST_ROWS,
                                    row -> guest(row, "checkOut")));
                        }
                        if (departuresWanted) {
                            // Stays that started up to 30 nights before and end on this day.
                            JsonNode staying = gateway.get(caller, BASE + "/reservations",
                                    Map.of("hotelId", id(hotel)), Map.of("status", "CONFIRMED,CHECKED_IN,CHECKED_OUT",
                                            "dateField", "CHECK_IN", "from", day.minusDays(30), "to", day,
                                            "size", 100, "sort", "checkIn,asc"));
                            List<Map<String, Object>> departures = new ArrayList<>();
                            int departureCount = 0;
                            for (JsonNode row : Out.content(staying)) {
                                if (day.toString().equals(Out.text(row, "checkOut"))) {
                                    departureCount++;
                                    if (departures.size() < MAX_GUEST_ROWS) {
                                        departures.add(guest(row, "checkIn"));
                                    }
                                }
                            }
                            summary.append(summary.isEmpty() ? "" : ", ").append(departureCount)
                                    .append(" leaving (check-out on ").append(day).append(")");
                            out.put("leaving", departures);
                        }
                        out.put("summary", summary.toString());
                        return out;
                    });
                });
    }

    /** A guest of an arrival or departure list, without the date that belongs to the other list. */
    private static Map<String, Object> guest(JsonNode row, String leaveOut) {
        Map<String, Object> out = reservation(row);
        out.remove(leaveOut);
        return out;
    }

    private ToolDefinition reservations() {
        return ToolDefinition.named("hotel_reservations")
                .title("Hotel reservations")
                .description("Search reservations of your hotels by status, check-in dates or guest name / "
                        + "booking reference / confirmation number.")
                .roles(HOTEL_MANAGER)
                .param(hotelParam())
                .param(Param.oneOf("status", "Reservation status", List.of("CONFIRMED", "CHECKED_IN", "CHECKED_OUT",
                        "NO_SHOW", "CANCELLED", "HELD", "EXPIRED", "RELEASED")))
                .param(Ranges.from("Check-in on or after, YYYY-MM-DD"))
                .param(Ranges.to("Check-in on or before, YYYY-MM-DD"))
                .param(Param.text("q", "Guest name, booking reference or confirmation number", 2, 80))
                .param(Param.integer("limit", "Maximum rows (default 10)", 1, 20))
                .handler((args, caller) -> {
                    Ranges.checkDates(args.date("from"), args.date("to"), false);
                    int limit = args.integer("limit", 10);
                    return perHotel(caller, args.text("hotel"), hotel -> {
                        Map<String, Object> query = new LinkedHashMap<>();
                        query.put("status", args.text("status"));
                        query.put("dateField", "CHECK_IN");
                        query.put("from", args.date("from"));
                        query.put("to", args.date("to"));
                        query.put("q", args.text("q"));
                        query.put("size", limit);
                        JsonNode page = gateway.get(caller, BASE + "/reservations", Map.of("hotelId", id(hotel)),
                                query);
                        Map<String, Object> out = new LinkedHashMap<>();
                        out.put("hotel", Out.text(hotel, "name"));
                        out.put("count", Out.total(page));
                        out.put("reservations", Out.rows(Out.content(page), limit, ManagerTools::reservation));
                        return out;
                    });
                });
    }

    private ToolDefinition occupancy() {
        return ToolDefinition.named("hotel_occupancy")
                .title("Occupancy and revenue")
                .description("Occupancy % (booked / available room nights), room revenue and ADR of your hotels "
                        + "for a period.")
                .roles(HOTEL_MANAGER)
                .param(hotelParam())
                .param(Ranges.range())
                .param(Ranges.from("First day for CUSTOM, YYYY-MM-DD"))
                .param(Ranges.to("Last day for CUSTOM, YYYY-MM-DD"))
                .handler((args, caller) -> perHotel(caller, args.text("hotel"), hotel -> {
                    Map<String, Object> query = Ranges.query(args);
                    JsonNode occupancy = gateway.get(caller, BASE + "/reports/occupancy",
                            Map.of("hotelId", id(hotel)), query);
                    JsonNode revenue = gateway.get(caller, BASE + "/reports/revenue", Map.of("hotelId", id(hotel)),
                            query);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("hotel", Out.text(hotel, "name"));
                    out.put("range", Out.pick(occupancy.path("range"), "preset", "from", "to"));
                    out.put("occupancy", Out.pick(occupancy.path("totals"), "roomNights", "bookedRoomNights",
                            "occupancyPercent"));
                    Map<String, Object> money = new LinkedHashMap<>();
                    Out.money(money, "roomRevenue", revenue.path("totals"), "revenue", Out.currency(revenue));
                    Out.money(money, "averageDailyRate", revenue.path("totals"), "averageDailyRate",
                            Out.currency(revenue));
                    out.put("revenue", money);
                    return out;
                }));
    }

    static Map<String, Object> reservation(JsonNode row) {
        Map<String, Object> out = Out.pick(row, "bookingReference", "status", "leadGuest", "roomTypeName",
                "checkIn", "checkOut", "nights", "rooms", "adults", "children", "confirmationNumber");
        Out.money(out, "total", row, "totalAmount", Out.currency(row));
        return out;
    }

    private JsonNode hotels(Caller caller) {
        JsonNode hotels = gateway.get(caller, "/api/hotel-manager/hotels", Map.of());
        return hotels.isArray() ? hotels : Out.content(hotels);
    }

    /** Runs {@code action} for the named hotel, or for every assigned hotel when no name is given. */
    private Object perHotel(Caller caller, String name, java.util.function.Function<JsonNode, Map<String, Object>> action) {
        List<JsonNode> all = new ArrayList<>();
        hotels(caller).forEach(all::add);
        if (all.isEmpty()) {
            throw new ToolFailure("NOT_FOUND", "No hotels are assigned to you yet. An admin assigns hotels.");
        }
        List<JsonNode> chosen = new ArrayList<>();
        if (name == null) {
            chosen.addAll(all.subList(0, Math.min(MAX_HOTELS, all.size())));
        } else {
            String wanted = name.toLowerCase(Locale.ROOT);
            for (JsonNode hotel : all) {
                String hotelName = String.valueOf(Out.text(hotel, "name")).toLowerCase(Locale.ROOT);
                if (hotelName.contains(wanted) || wanted.equals(Out.text(hotel, "slug"))
                        || wanted.equals(Out.text(hotel, "id"))) {
                    chosen.add(hotel);
                }
            }
            if (chosen.isEmpty()) {
                throw new ToolFailure("NOT_FOUND", "None of your hotels matches that name. Your hotels: "
                        + String.join(", ", all.stream().map(h -> Out.text(h, "name")).toList()) + ".");
            }
        }
        if (chosen.size() == 1) {
            return action.apply(chosen.getFirst());
        }
        return Map.of("hotels", chosen.stream().limit(MAX_HOTELS).map(action).toList());
    }

    private static String id(JsonNode hotel) {
        return Out.text(hotel, "id");
    }
}
