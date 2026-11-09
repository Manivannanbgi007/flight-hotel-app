package com.flighthotel.search.query;

import static com.flighthotel.search.index.SearchCategory.BOOKINGS;
import static com.flighthotel.search.index.SearchCategory.DESTINATIONS;
import static com.flighthotel.search.index.SearchCategory.HOTELS;
import static com.flighthotel.search.index.SearchCategory.PAGES;
import static com.flighthotel.search.index.SearchCategory.PAYMENTS;
import static com.flighthotel.search.index.SearchCategory.REFUNDS;
import static com.flighthotel.search.index.SearchCategory.REVIEWS;
import static com.flighthotel.search.index.SearchCategory.TICKETS;
import static com.flighthotel.search.index.SearchCategory.USERS;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.search.query.Viewer.ManagedHotel;
import com.flighthotel.testsupport.RoleTokens;

class AccessRulesTest {

    private static Viewer viewer(String role, List<ManagedHotel> hotels) {
        AuthenticatedUser user = new AuthenticatedUser(UUID.randomUUID(), role.toLowerCase() + "@example.com",
                Set.of(role), RoleTokens.PERMISSIONS.get(role), Instant.now().plusSeconds(600));
        return Viewer.of(user, () -> hotels);
    }

    @Test
    void eachRoleSearchesItsOwnCategories() {
        assertThat(AccessRules.categories(Viewer.anonymous())).containsExactly(HOTELS, DESTINATIONS, PAGES);
        assertThat(AccessRules.categories(viewer("CUSTOMER", List.of()))).containsExactly(HOTELS, DESTINATIONS,
                BOOKINGS, PAYMENTS, REFUNDS, TICKETS, REVIEWS, PAGES);
        assertThat(AccessRules.categories(viewer("HOTEL_MANAGER", List.of()))).containsExactly(HOTELS, BOOKINGS,
                REVIEWS, PAGES);
        assertThat(AccessRules.categories(viewer("SUPPORT_AGENT", List.of()))).containsExactly(USERS, BOOKINGS,
                PAYMENTS, REFUNDS, TICKETS, PAGES);
        assertThat(AccessRules.categories(viewer("ADMIN", List.of()))).containsExactly(USERS, HOTELS, DESTINATIONS,
                BOOKINGS, PAYMENTS, REFUNDS, TICKETS, REVIEWS, PAGES);
    }

    @Test
    void labelsSpeakTheViewersLanguage() {
        assertThat(AccessRules.label(BOOKINGS, viewer("CUSTOMER", List.of()))).isEqualTo("My trips");
        assertThat(AccessRules.label(BOOKINGS, viewer("HOTEL_MANAGER", List.of()))).isEqualTo("Reservations");
        assertThat(AccessRules.label(BOOKINGS, viewer("ADMIN", List.of()))).isEqualTo("Bookings");
        assertThat(AccessRules.label(USERS, viewer("SUPPORT_AGENT", List.of()))).isEqualTo("Customers");
        assertThat(AccessRules.label(HOTELS, viewer("HOTEL_MANAGER", List.of()))).isEqualTo("My hotels");
    }

    @Test
    void customersAreLimitedToTheirOwnRecords() {
        Viewer customer = viewer("CUSTOMER", List.of());
        assertThat(AccessRules.filter(PAYMENTS, customer).toString()).contains("ownerUserId=" + customer.userId());
        assertThat(AccessRules.filter(PAYMENTS, viewer("ADMIN", List.of())).toString()).doesNotContain("ownerUserId");
    }

    @Test
    void aManagerWithoutHotelsSeesNoReservations() {
        Map<String, Object> filter = AccessRules.filter(BOOKINGS, viewer("HOTEL_MANAGER", List.of()));
        assertThat(filter.toString()).contains("match_none");

        Map<String, Object> withHotel = AccessRules.filter(BOOKINGS,
                viewer("HOTEL_MANAGER", List.of(new ManagedHotel("h-1", "Sea View", "Goa"))));
        assertThat(withHotel.toString()).contains("hotelId=[h-1]").doesNotContain("match_none");
        assertThat(AccessRules.managedHotelIds(viewer("ADMIN", List.of()))).isNull();
    }

    @Test
    void supportAgentsOnlySeeCustomerAccounts() {
        assertThat(AccessRules.filter(USERS, viewer("SUPPORT_AGENT", List.of())).toString()).contains("roles=CUSTOMER");
        assertThat(AccessRules.filter(USERS, viewer("ADMIN", List.of())).toString()).doesNotContain("roles=CUSTOMER");
    }
}
