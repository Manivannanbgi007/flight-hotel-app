package com.flighthotel.search.query;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;

import com.flighthotel.common.security.AuthenticatedUser;

/**
 * Who is searching, taken from the verified access token (never from the request): user id, roles, permissions and,
 * for a hotel manager, the hotels they run (asked from hotel-service only when needed).
 */
public final class Viewer {

    public static final String ADMIN = "ADMIN";
    public static final String SUPPORT_AGENT = "SUPPORT_AGENT";
    public static final String HOTEL_MANAGER = "HOTEL_MANAGER";
    public static final String CUSTOMER = "CUSTOMER";
    /** The audience of pages for visitors who are not signed in. */
    public static final String ANONYMOUS = "ANONYMOUS";

    private final AuthenticatedUser user;
    private final Supplier<List<ManagedHotel>> hotelSource;
    private List<ManagedHotel> hotels;

    private Viewer(AuthenticatedUser user, Supplier<List<ManagedHotel>> hotelSource) {
        this.user = user;
        this.hotelSource = hotelSource;
    }

    public static Viewer anonymous() {
        return new Viewer(null, List::of);
    }

    public static Viewer of(AuthenticatedUser user, Supplier<List<ManagedHotel>> hotels) {
        return new Viewer(user, hotels);
    }

    public boolean signedIn() {
        return user != null;
    }

    public String userId() {
        return user == null ? null : user.id().toString();
    }

    public boolean hasRole(String role) {
        return user != null && user.hasRole(role);
    }

    public boolean can(String permission) {
        return user != null && user.hasPermission(permission);
    }

    public Set<String> permissions() {
        return user == null ? Set.of() : user.permissions();
    }

    public boolean isCustomer() {
        return hasRole(CUSTOMER);
    }

    /** A hotel manager limited to the hotels assigned to them (an admin manages every hotel instead). */
    public boolean managesAssignedHotels() {
        return can("HOTEL_MANAGE_ASSIGNED") && !can("HOTEL_MANAGE_ANY");
    }

    /** The hotels this manager runs (empty for everybody else). Asked once per search. */
    public List<ManagedHotel> managedHotels() {
        if (!managesAssignedHotels()) {
            return List.of();
        }
        if (hotels == null) {
            hotels = List.copyOf(hotelSource.get());
        }
        return hotels;
    }

    public List<String> managedHotelIds() {
        return managedHotels().stream().map(ManagedHotel::id).toList();
    }

    /** The role that decides labels: admin, then support agent, hotel manager, customer; ANONYMOUS when signed out. */
    public String primaryRole() {
        for (String role : List.of(ADMIN, SUPPORT_AGENT, HOTEL_MANAGER, CUSTOMER)) {
            if (hasRole(role)) {
                return role;
            }
        }
        return signedIn() ? CUSTOMER : ANONYMOUS;
    }

    /** The page audiences this viewer belongs to: their roles, or ANONYMOUS. */
    public List<String> audiences() {
        return user == null ? List.of(ANONYMOUS) : new ArrayList<>(user.roles());
    }

    /** A hotel the manager runs. */
    public record ManagedHotel(String id, String name, String city) {
    }
}
