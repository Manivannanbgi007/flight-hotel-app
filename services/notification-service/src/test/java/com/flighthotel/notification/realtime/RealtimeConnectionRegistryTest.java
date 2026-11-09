package com.flighthotel.notification.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.security.Roles;

class RealtimeConnectionRegistryTest {

    private final RealtimeConnectionRegistry registry = new RealtimeConnectionRegistry(2, 4);

    @Test
    void findsConnectionsByUserAndRoleWithoutDuplicates() {
        RealtimeConnection customer = connection("user-1", Roles.CUSTOMER);
        RealtimeConnection admin = connection("user-2", Roles.ADMIN);
        registry.register(customer);
        registry.register(admin);

        RealtimeAudience audience = new RealtimeAudience(Set.of("user-1", "user-2"), Set.of(Roles.ADMIN));

        assertThat(registry.connectionsFor(audience)).containsExactlyInAnyOrder(customer, admin);
        assertThat(registry.connectionsFor(RealtimeAudience.roles(Roles.SUPPORT_AGENT))).isEmpty();
    }

    @Test
    void closesTheOldestStreamWhenAUserOpensTooMany() {
        RealtimeConnection first = connection("user-1", Roles.CUSTOMER);
        RealtimeConnection second = connection("user-1", Roles.CUSTOMER);
        RealtimeConnection third = connection("user-1", Roles.CUSTOMER);
        registry.register(first);
        registry.register(second);
        registry.register(third);

        assertThat(first.isOpen()).isFalse();
        assertThat(registry.connectionsFor(new RealtimeAudience(Set.of("user-1"), Set.of())))
                .containsExactly(second, third);
        assertThat(registry.size()).isEqualTo(2);
    }

    @Test
    void rejectsNewStreamsWhenTheInstanceIsFull() {
        for (int i = 0; i < 4; i++) {
            registry.register(connection("user-" + i, Roles.CUSTOMER));
        }

        assertThatThrownBy(() -> registry.register(connection("user-x", Roles.CUSTOMER)))
                .isInstanceOf(ApiException.class)
                .hasFieldOrPropertyWithValue("code", "REALTIME_CAPACITY_REACHED");
    }

    @Test
    void closedConnectionsAreRemovedFromEveryIndex() {
        RealtimeConnection admin = connection("user-9", Roles.ADMIN);
        registry.register(admin);

        admin.close(null);

        assertThat(registry.size()).isZero();
        assertThat(registry.connectionsFor(RealtimeAudience.roles(Roles.ADMIN))).isEmpty();
    }

    private static RealtimeConnection connection(String userId, String role) {
        return new RealtimeConnection(UUID.randomUUID().toString(), userId, Set.of(role), Instant.now(),
                Instant.now().plusSeconds(900), new SseEmitter(), 16);
    }
}
