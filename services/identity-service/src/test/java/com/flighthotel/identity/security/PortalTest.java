package com.flighthotel.identity.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

/** Phase 11 §11.2: which sign-in page admits which roles, and where a staff invitation leads. */
class PortalTest {

    @Test
    void eachPortalAdmitsItsRoleAndAdminsTheStaffOnes() {
        assertThat(Portal.forRoles(Set.of("CUSTOMER"))).containsExactly(Portal.CUSTOMER);
        assertThat(Portal.forRoles(Set.of("ADMIN")))
                .containsExactly(Portal.ADMIN, Portal.HOTEL_MANAGER, Portal.SUPPORT);
        assertThat(Portal.forRoles(Set.of("HOTEL_MANAGER"))).containsExactly(Portal.HOTEL_MANAGER);
        assertThat(Portal.forRoles(Set.of("SUPPORT_AGENT"))).containsExactly(Portal.SUPPORT);
        // An account with two roles may use both pages.
        assertThat(Portal.forRoles(List.of("SUPPORT_AGENT", "CUSTOMER"))).containsExactly(Portal.CUSTOMER,
                Portal.SUPPORT);
        assertThat(Portal.forRoles(Set.of())).isEmpty();
        assertThat(Portal.CUSTOMER.admits(Set.of("ADMIN"))).isFalse();
        assertThat(Portal.SUPPORT.admits(Set.of("HOTEL_MANAGER"))).isFalse();
    }

    @Test
    void anInvitationLeadsToTheSignInOfTheStaffRole() {
        assertThat(Portal.invitationSignIn(Set.of("ADMIN"))).isEqualTo("admin");
        assertThat(Portal.invitationSignIn(Set.of("HOTEL_MANAGER"))).isEqualTo("hotel-manager");
        assertThat(Portal.invitationSignIn(Set.of("SUPPORT_AGENT", "CUSTOMER"))).isEqualTo("support");
        assertThat(Portal.invitationSignIn(Set.of("SUPPORT_AGENT", "ADMIN"))).isEqualTo("admin");
        assertThat(Portal.invitationSignIn(Set.of("CUSTOMER"))).isNull();
    }
}
