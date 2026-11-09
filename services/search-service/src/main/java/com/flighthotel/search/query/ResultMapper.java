package com.flighthotel.search.query;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.springframework.web.util.UriUtils;

import com.flighthotel.search.index.SearchCategory;
import com.flighthotel.search.query.Viewer.ManagedHotel;
import com.flighthotel.search.support.Format;
import com.flighthotel.search.web.SearchDtos.Action;
import com.flighthotel.search.web.SearchDtos.Highlight;
import com.flighthotel.search.web.SearchDtos.Meta;
import com.flighthotel.search.web.SearchDtos.SearchResult;
import com.flighthotel.search.web.SearchDtos.Status;
import com.flighthotel.search.web.SearchDtos.TextSegment;

/**
 * A stored document → what the user sees: title, subtitle, status chip, details and the link. Links depend on who
 * looks: the same booking opens {@code /admin/bookings/…} for an admin, {@code /support/bookings/…} for an agent,
 * {@code /my-trips/…} for its customer and the reservation page for the hotel's manager. Every link is an existing route
 * of the web app (frontend test searchRoutes.test.ts checks them), and the page it opens checks access again.
 */
final class ResultMapper {

    private ResultMapper() {
    }

    /** A document of the search service's own index. */
    static SearchResult own(SearchCategory category, Map<String, Object> doc, Map<String, List<String>> highlight,
            Viewer viewer, ParsedQuery query) {
        String id = str(doc.get("entityId"));
        Map<String, Object> display = map(doc.get("display"));
        List<TextSegment> titleMarks = Highlights.first(highlight, "title", "title.prefix");
        List<TextSegment> subtitleMarks = Highlights.first(highlight, "subtitle", "subtitle.prefix");
        List<TextSegment> snippetMarks = Highlights.first(highlight, "description");
        if (snippetMarks == null) {
            String matches = Highlights.joined(highlight, "names", "names.prefix", "details", "details.prefix");
            snippetMarks = matches == null ? null : Highlights.segments(matches);
        }
        String snippet = snippetMarks != null ? Highlights.plain(snippetMarks) : shorten(str(doc.get("description")));
        String title = str(doc.get("title"));
        String subtitle = str(doc.get("subtitle"));
        String status = str(doc.get("status"));
        List<Meta> meta = new ArrayList<>();
        List<Action> actions = new ArrayList<>();
        String url;

        switch (category) {
            case BOOKINGS -> {
                url = bookingUrl(doc, viewer);
                meta(meta, "Reference", doc.get("reference"));
                meta(meta, "Type", "HOTEL".equals(doc.get("type")) ? "Hotel" : "Flight");
                meta(meta, "Dates", Format.dateRange(doc.get("date"), doc.get("endDate")));
                meta(meta, "Amount", Format.money(doc.get("amount"), doc.get("currency")));
                meta(meta, "Payment", Format.humanize(doc.get("paymentStatus")));
                if (!viewer.isCustomer() || viewer.can("BOOKING_READ_ANY")) {
                    meta(meta, "Contact", display.get("contactEmail"));
                }
            }
            case PAYMENTS -> {
                url = paymentUrl(doc, viewer);
                subtitle = Format.join(Format.money(doc.get("amount"), doc.get("currency")), method(doc.get("method")),
                        doc.get("reference"));
                subtitleMarks = null;
                meta(meta, "Amount", Format.money(doc.get("amount"), doc.get("currency")));
                meta(meta, "Method", method(doc.get("method")));
                meta(meta, "Booking", doc.get("reference"));
                meta(meta, "Date", Format.date(doc.get("date")));
            }
            case REFUNDS -> {
                url = refundUrl(doc, viewer);
                subtitle = Format.join(Format.money(doc.get("amount"), doc.get("currency")), doc.get("reference"));
                subtitleMarks = null;
                meta(meta, "Amount", Format.money(doc.get("amount"), doc.get("currency")));
                meta(meta, "Booking", doc.get("reference"));
                meta(meta, "Requested", Format.date(doc.get("date")));
            }
            case USERS -> {
                url = viewer.hasRole(Viewer.ADMIN) ? "/admin/users/" + id
                        : "/support/bookings?q=" + encode(doc.get("subtitle"));
                meta(meta, "Roles", roles(doc.get("roles")));
                meta(meta, "Registered", Format.date(doc.get("createdAt")));
            }
            case TICKETS -> {
                url = viewer.can("SUPPORT_TICKET_MANAGE") ? "/support/tickets/" + id : "/account/support/" + id;
                meta(meta, "Ticket", display.get("ticketNumber"));
                meta(meta, "Priority", Format.humanize(doc.get("priority")));
                meta(meta, "Booking", display.get("bookingReference"));
                meta(meta, "Updated", Format.date(doc.get("date")));
            }
            case REVIEWS -> {
                url = reviewUrl(doc, viewer);
                meta(meta, "Rating", display.get("rating") == null ? null : display.get("rating") + " / 5");
                meta(meta, "Hotel", display.get("hotelName"));
                meta(meta, "Stayed", Format.date(doc.get("date")));
            }
            case DESTINATIONS -> {
                String city = str(display.get("city"));
                int hotels = display.get("hotels") instanceof Number n ? n.intValue() : 0;
                List<Map<String, Object>> airports = listOfMaps(display.get("airports"));
                String code = airports.isEmpty() ? null : str(airports.getFirst().get("code"));
                String hotelsUrl = "/hotels/search?destination=" + encode(city);
                String flightsUrl = code == null ? null : "/flights/search?destination=" + encode(code);
                if (hotels > 0) {
                    actions.add(new Action("Hotels in " + city, hotelsUrl));
                }
                if (flightsUrl != null) {
                    actions.add(new Action("Flights to " + city, flightsUrl));
                }
                url = (query.flightIntent() || hotels == 0) && flightsUrl != null ? flightsUrl : hotelsUrl;
                meta(meta, "Hotels", hotels > 0 ? String.valueOf(hotels) : null);
                meta(meta, "Airports", airports.stream().map(a -> a.get("code") + " " + a.get("name")).reduce((a, b) -> a + ", " + b)
                        .orElse(null));
            }
            case PAGES -> {
                String template = str(display.get("url"));
                url = template;
                if (Boolean.TRUE.equals(doc.get("perHotel"))) {
                    List<ManagedHotel> hotels = viewer.managedHotels().stream()
                            .sorted(Comparator.comparing(ManagedHotel::name)).toList();
                    url = template.replace("{hotelId}", hotels.getFirst().id());
                    if (hotels.size() == 1) {
                        meta(meta, "Hotel", hotels.getFirst().name());
                    } else {
                        hotels.forEach(hotel -> actions.add(new Action(hotel.name(), template.replace("{hotelId}", hotel.id()))));
                    }
                }
            }
            default -> throw new IllegalArgumentException("Not stored in the own index: " + category);
        }
        return new SearchResult(category.name() + ":" + id, category, title, subtitle, snippet, url,
                status(category, status), meta, actions, new Highlight(titleMarks, subtitleMarks, snippetMarks));
    }

    /** A hotel of hotel-service's {@code hotels} index. */
    static SearchResult hotel(Map<String, Object> doc, Map<String, List<String>> highlight, Viewer viewer) {
        String id = str(doc.get("id"));
        String name = str(doc.get("name"));
        String city = str(doc.get("city"));
        String state = str(doc.get("state"));
        String subtitle = state == null ? city : city + ", " + state;
        List<TextSegment> cityMarks = Highlights.first(highlight, "city");
        List<TextSegment> subtitleMarks = null;
        if (cityMarks != null) {
            subtitleMarks = new ArrayList<>(cityMarks);
            if (state != null) {
                subtitleMarks.add(new TextSegment(", " + state, false));
            }
        }
        String url;
        if (viewer.can("HOTEL_MANAGE_ANY")) {
            url = "/admin/hotels?q=" + encode(name);
        } else if (viewer.managesAssignedHotels()) {
            url = "/hotel-manager/hotels/" + id + "/dashboard";
        } else {
            url = "/hotels/" + doc.get("slug");
        }
        List<Meta> meta = new ArrayList<>();
        meta(meta, "Stars", doc.get("starRating") == null ? null : doc.get("starRating") + "-star");
        if (doc.get("guestRating") instanceof Number rating && rating.doubleValue() > 0) {
            meta(meta, "Guest rating", String.format("%.1f / 5", rating.doubleValue())
                    + (doc.get("reviewCount") instanceof Number reviews ? " (" + reviews + " reviews)" : ""));
        }
        meta(meta, "Type", Format.humanize(doc.get("propertyType")));
        return new SearchResult("HOTELS:" + id, SearchCategory.HOTELS, name, subtitle, null, url, null, meta, List.of(),
                new Highlight(Highlights.first(highlight, "name"), subtitleMarks, null));
    }

    // ----- links -----

    private static String bookingUrl(Map<String, Object> doc, Viewer viewer) {
        String id = str(doc.get("entityId"));
        if (viewer.can("BOOKING_READ_ANY") && viewer.hasRole(Viewer.ADMIN)) {
            return "/admin/bookings/" + id;
        }
        if (viewer.can("BOOKING_READ_ANY")) {
            return "/support/bookings/" + id;
        }
        if (Objects.equals(viewer.userId(), doc.get("ownerUserId"))) {
            return "/my-trips/" + id;
        }
        String hotelId = str(doc.get("hotelId"));
        String reservationId = str(doc.get("reservationId"));
        return reservationId != null
                ? "/hotel-manager/hotels/" + hotelId + "/reservations/" + reservationId
                : "/hotel-manager/hotels/" + hotelId + "/reservations?q=" + encode(doc.get("reference"));
    }

    private static String paymentUrl(Map<String, Object> doc, Viewer viewer) {
        if (viewer.can("PAYMENT_READ_ANY") && viewer.hasRole(Viewer.ADMIN)) {
            return "/admin/payments/" + doc.get("entityId");
        }
        if (viewer.can("PAYMENT_READ_ANY")) {
            return supportBookingUrl(doc);
        }
        return doc.get("reference") == null ? "/account/payments" : "/account/payments?q=" + encode(doc.get("reference"));
    }

    private static String refundUrl(Map<String, Object> doc, Viewer viewer) {
        if (viewer.can("PAYMENT_READ_ANY") && viewer.hasRole(Viewer.ADMIN)) {
            return doc.get("reference") == null ? "/admin/refunds" : "/admin/refunds?q=" + encode(doc.get("reference"));
        }
        if (viewer.can("PAYMENT_READ_ANY")) {
            return supportBookingUrl(doc);
        }
        return doc.get("bookingId") == null ? "/account/payments" : "/my-trips/" + doc.get("bookingId");
    }

    private static String supportBookingUrl(Map<String, Object> doc) {
        return doc.get("bookingId") != null ? "/support/bookings/" + doc.get("bookingId")
                : "/support/bookings?q=" + encode(doc.get("reference"));
    }

    private static String reviewUrl(Map<String, Object> doc, Viewer viewer) {
        if (viewer.can("REVIEW_MODERATE")) {
            return doc.get("reference") == null ? "/admin/reviews" : "/admin/reviews?q=" + encode(doc.get("reference"));
        }
        if (Objects.equals(viewer.userId(), doc.get("ownerUserId"))) {
            return "/account/reviews";
        }
        return "/hotel-manager/hotels/" + doc.get("hotelId") + "/reviews";
    }

    // ----- statuses and small helpers -----

    static Status status(SearchCategory category, String status) {
        if (status == null || category == SearchCategory.PAGES || category == SearchCategory.DESTINATIONS) {
            return null;
        }
        String label = switch (status) {
            case "SUCCEEDED" -> "Successful";
            case "PENDING_VERIFICATION" -> "Not verified";
            case "WAITING_CUSTOMER" -> "Waiting for customer";
            case "COMPLETED" -> category == SearchCategory.REFUNDS ? "Refunded" : "Completed";
            case "APPROVED" -> "Published";
            case "PENDING" -> category == SearchCategory.REVIEWS ? "Awaiting moderation" : "Pending";
            default -> Format.humanize(status);
        };
        String tone = switch (status) {
            case "CONFIRMED", "COMPLETED", "SUCCEEDED", "ACTIVE", "APPROVED", "RESOLVED" -> "success";
            case "CANCELLED", "FAILED", "EXPIRED", "REJECTED", "DEACTIVATED", "ESCALATED" -> "danger";
            case "OPEN", "IN_PROGRESS", "REFUNDED" -> "info";
            case "CLOSED" -> "neutral";
            default -> "warning";
        };
        return new Status(label, tone);
    }

    private static String method(Object method) {
        if (method == null) {
            return null;
        }
        return switch (String.valueOf(method)) {
            case "UPI" -> "UPI";
            case "NETBANKING" -> "Net banking";
            default -> Format.humanize(method);
        };
    }

    private static String roles(Object roles) {
        if (!(roles instanceof List<?> list) || list.isEmpty()) {
            return null;
        }
        return String.join(", ", list.stream().map(role -> switch (String.valueOf(role)) {
            case "ADMIN" -> "Administrator";
            case "HOTEL_MANAGER" -> "Hotel manager";
            case "SUPPORT_AGENT" -> "Support agent";
            case "CUSTOMER" -> "Customer";
            default -> Format.humanize(role);
        }).toList());
    }

    private static void meta(List<Meta> meta, String label, Object value) {
        if (value != null && !String.valueOf(value).isBlank()) {
            meta.add(new Meta(label, String.valueOf(value)));
        }
    }

    private static String shorten(String text) {
        if (text == null) {
            return null;
        }
        return text.length() <= 180 ? text : text.substring(0, 177).strip() + "…";
    }

    static String encode(Object value) {
        return value == null ? "" : UriUtils.encodeQueryParam(String.valueOf(value), StandardCharsets.UTF_8);
    }

    private static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listOfMaps(Object value) {
        return value instanceof List<?> list ? (List<Map<String, Object>>) list : List.of();
    }
}
