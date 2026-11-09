package com.flighthotel.assistant.blocks;

import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;

import com.flighthotel.common.security.Roles;

/**
 * The pages the assistant may point to: an allowlist of route KEYS, never paths or URLs. The model cannot add to it,
 * and nothing it writes is turned into a destination. The browser maps each key to its own path (and checks the user's
 * role again): a key it does not know is dropped, so there is never a broken or foreign link.
 *
 * <p>{@code hotelScoped} routes belong to one of the manager's hotels; the action carries the hotel's NAME from a tool
 * result and the browser looks the id up in the manager's own (authorised) hotel list. No id is ever sent from here.
 */
public enum Route {

    // ---- Customer ----
    MY_TRIPS("View My Trips", "luggage", false, Roles.CUSTOMER),
    PAYMENTS("View All Payments", "wallet", false, Roles.CUSTOMER),
    NOTIFICATIONS("View Notifications", "bell", false, Roles.CUSTOMER),
    SUPPORT("Open Support", "life-buoy", false, Roles.CUSTOMER),
    NEW_TICKET("New Support Ticket", "message-square-plus", false, Roles.CUSTOMER),
    PROFILE("Open My Profile", "user", false, Roles.CUSTOMER),
    PASSENGERS("Manage Passengers", "users", false, Roles.CUSTOMER),
    PREFERENCES("Manage Preferences", "sliders", false, Roles.CUSTOMER),
    SECURITY("Security Settings", "shield", false, Roles.CUSTOMER),
    MY_REVIEWS("My Reviews", "star", false, Roles.CUSTOMER),
    CUSTOMER_DASHBOARD("My Dashboard", "layout-dashboard", false, Roles.CUSTOMER),
    OFFERS("See Offers", "tag", false, Roles.CUSTOMER),
    HOTEL_SEARCH("Search Hotels", "building", false, Roles.CUSTOMER),
    FLIGHT_SEARCH("Search Flights", "plane", false, Roles.CUSTOMER),

    // ---- Admin ----
    ADMIN_DASHBOARD("Admin Dashboard", "layout-dashboard", false, Roles.ADMIN),
    ADMIN_BOOKINGS("Manage Bookings", "clipboard-list", false, Roles.ADMIN),
    ADMIN_PAYMENTS("Manage Payments", "wallet", false, Roles.ADMIN),
    ADMIN_REFUNDS("Manage Refunds", "undo", false, Roles.ADMIN),
    ADMIN_REPORTS("Open Reports", "bar-chart", false, Roles.ADMIN),
    ADMIN_SUPPORT("Manage Support", "life-buoy", false, Roles.ADMIN),
    ADMIN_USERS("Manage Users", "users", false, Roles.ADMIN),
    ADMIN_HOTELS("Manage Hotels", "building", false, Roles.ADMIN),

    // ---- Hotel manager ----
    HOTEL_HOME("My Hotels", "building", false, Roles.HOTEL_MANAGER),
    HOTEL_DASHBOARD("Hotel Dashboard", "layout-dashboard", true, Roles.HOTEL_MANAGER),
    HOTEL_RESERVATIONS("View Reservations", "clipboard-list", true, Roles.HOTEL_MANAGER),
    HOTEL_ROOMS("Manage Rooms", "bed", true, Roles.HOTEL_MANAGER),
    HOTEL_INVENTORY("Manage Inventory", "calendar", true, Roles.HOTEL_MANAGER),
    HOTEL_REVIEWS("View Reviews", "star", true, Roles.HOTEL_MANAGER),
    HOTEL_REPORTS("Open Reports", "bar-chart", true, Roles.HOTEL_MANAGER),
    HOTEL_PROFILE("Hotel Profile", "hotel", true, Roles.HOTEL_MANAGER),
    HOTEL_PHOTOS("Manage Photos", "image", true, Roles.HOTEL_MANAGER),

    // ---- Support agent ----
    SUPPORT_HOME("Support Dashboard", "layout-dashboard", false, Roles.SUPPORT_AGENT),
    SUPPORT_TICKETS("Open Ticket Queue", "inbox", false, Roles.SUPPORT_AGENT),
    SUPPORT_BOOKINGS("Find Bookings", "search", false, Roles.SUPPORT_AGENT),
    SUPPORT_ATTENTION("Needs Attention", "alert-triangle", false, Roles.SUPPORT_AGENT);

    private final String label;
    private final String icon;
    private final boolean hotelScoped;
    private final String role;

    Route(String label, String icon, boolean hotelScoped, String role) {
        this.label = label;
        this.icon = icon;
        this.hotelScoped = hotelScoped;
        this.role = role;
    }

    public String label() {
        return label;
    }

    public String icon() {
        return icon;
    }

    public boolean hotelScoped() {
        return hotelScoped;
    }

    /** May a user with these roles be shown this page? Each role is shown the pages of its own portal. */
    public boolean allowedFor(Set<String> roles) {
        return roles.contains(role);
    }

    /** The routes a user with these roles may be shown. */
    public static Set<Route> allowedRoutes(Set<String> roles) {
        Set<Route> allowed = EnumSet.noneOf(Route.class);
        for (Route route : values()) {
            if (route.allowedFor(roles)) {
                allowed.add(route);
            }
        }
        return allowed;
    }

    /** The route for a key, or empty when it is not on the allowlist. */
    public static Optional<Route> parse(String key) {
        if (key == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(valueOf(key));
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }
}
