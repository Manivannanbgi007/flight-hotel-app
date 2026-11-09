package com.flighthotel.notification.messaging;

import java.util.UUID;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.identity.EmailVerified;
import com.flighthotel.notification.service.NotificationService;

/**
 * Account events of identity-service ({@code identity.events}): a welcome in the bell once the e-mail is verified (the
 * verification e-mail itself comes from {@code identity-email.events}).
 */
@Component
public class IdentityEventsListener {

    static final String CONSUMER = "notification-identity";

    /** A welcome only makes sense right after the verification (the group replays the topic when first started). */
    static final java.time.Duration WELCOME_WINDOW = java.time.Duration.ofHours(24);

    private final ProcessedEventStore processedEvents;
    private final NotificationService notifications;
    private final java.time.Clock clock;

    public IdentityEventsListener(ProcessedEventStore processedEvents, NotificationService notifications,
            java.time.Clock clock) {
        this.processedEvents = processedEvents;
        this.notifications = notifications;
        this.clock = clock;
    }

    @KafkaListener(id = CONSUMER, groupId = CONSUMER, topics = "identity.events")
    @Transactional
    public void onIdentityEvent(ConsumerRecord<String, Object> record) {
        handle(EventHeaders.eventId(record), record.value());
    }

    /** Also called directly by tests (same transaction rules). */
    @Transactional
    public void handle(String eventId, Object event) {
        if (!processedEvents.markProcessed(eventId, CONSUMER)) {
            return;
        }
        if (event instanceof EmailVerified verified
                && verified.getVerifiedAt().isAfter(clock.instant().minus(WELCOME_WINDOW))) {
            notifications.create(UUID.fromString(verified.getUserId()), "ACCOUNT", "Welcome to FlightHotel",
                    "Hello " + verified.getFirstName() + ", your account is ready. Search flights and hotels and "
                            + "find all your bookings under My Trips.", "/", eventId);
        }
    }
}
