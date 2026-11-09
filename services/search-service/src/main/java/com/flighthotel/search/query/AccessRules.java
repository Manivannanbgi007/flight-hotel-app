package com.flighthotel.search.query;

import static com.flighthotel.search.query.Viewer.ADMIN;
import static com.flighthotel.search.query.Viewer.CUSTOMER;
import static com.flighthotel.search.query.Viewer.HOTEL_MANAGER;
import static com.flighthotel.search.query.Viewer.SUPPORT_AGENT;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import com.flighthotel.search.index.SearchCategory;

/**
 * Who may find what. This is the security core of global search: every query gets these filters <b>inside
 * Elasticsearch</b>, built from the verified token, so a result the user may not see is never even returned.
 * <pre>
 * Category      Signed out  Customer  Hotel manager          Support agent   Admin
 * USERS         -           -         -                      customers       all
 * HOTELS        active      active    the hotels they run    -               active
 * DESTINATIONS  yes         yes       -                      -               yes
 * BOOKINGS      -           own       their hotels' bookings all             all
 * PAYMENTS      -           own       -                      all             all
 * REFUNDS       -           own       -                      all             all
 * TICKETS       -           own       -                      all             all
 * REVIEWS       -           own       their hotels' reviews  -               all
 * PAGES         public      public + account pages, staff: their portal's pages (and only with the page's permission)
 * </pre>
 * "all" follows the same permissions the owning services check (BOOKING_READ_ANY, PAYMENT_READ_ANY, ...).
 */
public final class AccessRules {

    private static final Map<String, Object> MATCH_NONE = Map.of("match_none", Map.of());

    private AccessRules() {
    }

    /** The categories this viewer may search, in display order. */
    public static List<SearchCategory> categories(Viewer viewer) {
        return Arrays.stream(SearchCategory.values()).filter(category -> allowed(category, viewer)).toList();
    }

    public static boolean allowed(SearchCategory category, Viewer viewer) {
        boolean customer = viewer.isCustomer();
        boolean manager = viewer.managesAssignedHotels();
        return switch (category) {
            case USERS -> viewer.can("USER_READ_ANY");
            case HOTELS -> !viewer.signedIn() || customer || manager || viewer.can("HOTEL_MANAGE_ANY");
            case DESTINATIONS -> !viewer.signedIn() || customer || viewer.hasRole(ADMIN);
            case BOOKINGS -> viewer.can("BOOKING_READ_ANY") || customer || manager;
            case PAYMENTS, REFUNDS -> viewer.can("PAYMENT_READ_ANY") || customer;
            case TICKETS -> viewer.can("SUPPORT_TICKET_MANAGE") || customer;
            case REVIEWS -> viewer.can("REVIEW_MODERATE") || customer || manager;
            case PAGES -> true;
        };
    }

    /**
     * The Elasticsearch filter for one category of the search service's own index: the category itself and what of it
     * this viewer may see. (HOTELS live in hotel-service's index: see {@link #managedHotelIds}.)
     */
    public static Map<String, Object> filter(SearchCategory category, Viewer viewer) {
        List<Object> must = new ArrayList<>();
        must.add(term("category", category.name()));
        List<Object> mustNot = new ArrayList<>();
        switch (category) {
            case USERS -> {
                // Admins see every account; support agents (who also have USER_READ_ANY) only customers.
                if (!viewer.hasRole(ADMIN)) {
                    must.add(term("roles", CUSTOMER));
                }
            }
            case BOOKINGS -> {
                if (!viewer.can("BOOKING_READ_ANY")) {
                    must.add(ownOrHotels(viewer, true, true));
                }
            }
            case PAYMENTS, REFUNDS -> {
                if (!viewer.can("PAYMENT_READ_ANY")) {
                    must.add(ownOrHotels(viewer, true, false));
                }
            }
            case TICKETS -> {
                if (!viewer.can("SUPPORT_TICKET_MANAGE")) {
                    must.add(ownOrHotels(viewer, true, false));
                }
            }
            case REVIEWS -> {
                if (!viewer.can("REVIEW_MODERATE")) {
                    must.add(ownOrHotels(viewer, true, true));
                }
            }
            case PAGES -> {
                must.add(Map.of("terms", Map.of("audience", viewer.audiences())));
                // A page that needs a permission the viewer lacks stays hidden.
                mustNot.add(Map.of("bool", Map.of(
                        "filter", List.of(Map.of("exists", Map.of("field", "permission"))),
                        "must_not", List.of(Map.of("terms", Map.of("permission", List.copyOf(viewer.permissions())))))));
                if (viewer.managedHotels().isEmpty()) {
                    mustNot.add(term("perHotel", true));
                }
            }
            case DESTINATIONS, HOTELS -> {
                // Public.
            }
        }
        return Map.of("bool", Map.of("filter", must, "must_not", mustNot));
    }

    /**
     * Hotels: null when the viewer may see every active hotel, otherwise the ids of the hotels they run (possibly
     * none).
     */
    public static List<String> managedHotelIds(Viewer viewer) {
        return viewer.managesAssignedHotels() ? viewer.managedHotelIds() : null;
    }

    /** What the category is called for this viewer ("My trips" for a customer, "Reservations" for a manager). */
    public static String label(SearchCategory category, Viewer viewer) {
        String role = viewer.primaryRole();
        boolean customer = CUSTOMER.equals(role);
        boolean manager = HOTEL_MANAGER.equals(role);
        return switch (category) {
            case USERS -> SUPPORT_AGENT.equals(role) ? "Customers" : "Users";
            case HOTELS -> manager ? "My hotels" : "Hotels";
            case DESTINATIONS -> "Destinations";
            case BOOKINGS -> customer ? "My trips" : manager ? "Reservations" : "Bookings";
            case PAYMENTS -> customer ? "My payments" : "Payments";
            case REFUNDS -> customer ? "My refunds" : "Refunds";
            case TICKETS -> customer ? "My support tickets" : "Support tickets";
            case REVIEWS -> customer ? "My reviews" : manager ? "Guest reviews" : "Reviews";
            case PAGES -> "Pages";
        };
    }

    /** The viewer's own records and/or the records of the hotels they run; matches nothing when neither applies. */
    private static Map<String, Object> ownOrHotels(Viewer viewer, boolean own, boolean hotels) {
        List<Object> should = new ArrayList<>();
        if (own && viewer.isCustomer()) {
            should.add(term("ownerUserId", viewer.userId()));
        }
        if (hotels && viewer.managesAssignedHotels() && !viewer.managedHotelIds().isEmpty()) {
            should.add(Map.of("terms", Map.of("hotelId", viewer.managedHotelIds())));
        }
        return should.isEmpty() ? MATCH_NONE : Map.of("bool", Map.of("should", should, "minimum_should_match", 1));
    }

    private static Map<String, Object> term(String field, Object value) {
        return Map.of("term", Map.of(field, value));
    }
}
