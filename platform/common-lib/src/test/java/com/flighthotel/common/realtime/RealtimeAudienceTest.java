package com.flighthotel.common.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.flighthotel.common.security.Roles;

class RealtimeAudienceTest {

    private final UUID owner = UUID.randomUUID();

    @Test
    void includesTheTargetUser() {
        RealtimeAudience audience = RealtimeAudience.user(owner);

        assertThat(audience.includes(owner.toString(), List.of(Roles.CUSTOMER))).isTrue();
        assertThat(audience.includes(UUID.randomUUID().toString(), List.of(Roles.CUSTOMER))).isFalse();
    }

    @Test
    void includesUsersWithATargetRole() {
        RealtimeAudience audience = RealtimeAudience.user(owner).andRoles(Roles.ADMIN, Roles.SUPPORT_AGENT);

        assertThat(audience.includes("someone-else", List.of(Roles.SUPPORT_AGENT))).isTrue();
        assertThat(audience.includes("someone-else", List.of(Roles.HOTEL_MANAGER))).isFalse();
    }

    @Test
    void rejectsAnEmptyAudience() {
        assertThatThrownBy(() -> new RealtimeAudience(null, null)).isInstanceOf(IllegalArgumentException.class);
    }
}
