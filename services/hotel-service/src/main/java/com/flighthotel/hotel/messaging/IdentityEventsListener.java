package com.flighthotel.hotel.messaging;

import java.time.Clock;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.identity.EmailVerified;
import com.flighthotel.events.identity.UserProfileUpdated;
import com.flighthotel.events.identity.UserRegistered;
import com.flighthotel.events.identity.UserRolesChanged;
import com.flighthotel.events.identity.UserStatusChanged;
import com.flighthotel.hotel.demo.DemoHotelSeeder;
import com.flighthotel.hotel.staff.KnownUserStore;
import com.flighthotel.hotel.staff.KnownUserStore.KnownUser;

/** Keeps {@code known_users} (the local copy of identity's accounts) up to date. Idempotent. */
@Component
public class IdentityEventsListener {

    static final String CONSUMER = "hotel-service-identity-users";

    private final ProcessedEventStore processedEvents;
    private final KnownUserStore users;
    private final ObjectProvider<DemoHotelSeeder> demoSeeder;
    private final Clock clock;

    public IdentityEventsListener(ProcessedEventStore processedEvents, KnownUserStore users,
            ObjectProvider<DemoHotelSeeder> demoSeeder, Clock clock) {
        this.processedEvents = processedEvents;
        this.users = users;
        this.demoSeeder = demoSeeder;
        this.clock = clock;
    }

    @KafkaListener(id = CONSUMER, groupId = CONSUMER, topics = "identity.events")
    @Transactional
    public void onIdentityEvent(ConsumerRecord<String, Object> record) {
        if (!processedEvents.markProcessed(EventHeaders.eventId(record), CONSUMER)) {
            return;
        }
        switch (record.value()) {
            case UserRegistered event -> {
                KnownUser user = new KnownUser(UUID.fromString(event.getUserId()), event.getEmail(), event.getFirstName(),
                        event.getLastName(), new TreeSet<>(event.getRoles()), event.getStatus());
                users.upsert(user, clock.instant());
                demoSeeder.ifAvailable(seeder -> seeder.onUserKnown(user));
            }
            case EmailVerified event -> users.updateStatus(UUID.fromString(event.getUserId()), "ACTIVE", clock.instant());
            case UserProfileUpdated event -> users.updateProfile(UUID.fromString(event.getUserId()), event.getEmail(),
                    event.getFirstName(), event.getLastName(), clock.instant());
            case UserStatusChanged event -> users.updateStatus(UUID.fromString(event.getUserId()), event.getStatus(),
                    clock.instant());
            case UserRolesChanged event -> users.updateRoles(UUID.fromString(event.getUserId()),
                    Set.copyOf(event.getRoles()), clock.instant());
            default -> {
                // Other identity events are not needed here.
            }
        }
    }
}
