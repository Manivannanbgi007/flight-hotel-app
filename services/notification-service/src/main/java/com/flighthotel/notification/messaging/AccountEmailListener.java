package com.flighthotel.notification.messaging;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.identity.AuthEmailRequested;
import com.flighthotel.notification.email.AccountEmailComposer;
import com.flighthotel.notification.email.EmailContent;
import com.flighthotel.notification.email.EmailSender;
import com.flighthotel.notification.entity.EmailMessage;
import com.flighthotel.notification.entity.EmailMessage.EmailStatus;
import com.flighthotel.notification.repository.EmailMessageRepository;

/**
 * Sends the account emails identity-service asks for (verification, password reset, invitation, ...).
 * <p>
 * Delivery is at-least-once: the "processed" marker and the log row commit together after the SMTP server accepted
 * the email. If sending fails, the transaction rolls back and Kafka retries (then the dead-letter topic). A crash
 * between "sent" and "commit" can send one duplicate, which is harmless for these emails.
 */
@Component
public class AccountEmailListener {

    static final String TOPIC = "identity-email.events";
    static final String CONSUMER = "notification-account-email";
    private static final Logger log = LoggerFactory.getLogger(AccountEmailListener.class);

    private final ProcessedEventStore processedEvents;
    private final AccountEmailComposer composer;
    private final EmailSender sender;
    private final EmailMessageRepository emailMessages;
    private final Clock clock;

    public AccountEmailListener(ProcessedEventStore processedEvents, AccountEmailComposer composer, EmailSender sender,
            EmailMessageRepository emailMessages, Clock clock) {
        this.processedEvents = processedEvents;
        this.composer = composer;
        this.sender = sender;
        this.emailMessages = emailMessages;
        this.clock = clock;
    }

    @KafkaListener(id = CONSUMER, groupId = CONSUMER, topics = TOPIC)
    @Transactional
    public void onEmailRequested(ConsumerRecord<String, Object> record) {
        if (!(record.value() instanceof AuthEmailRequested request)) {
            log.warn("Ignoring unexpected event type={} on {}", EventHeaders.eventType(record), TOPIC);
            return;
        }
        String eventId = EventHeaders.eventId(record);
        if (!processedEvents.markProcessed(eventId, CONSUMER)) {
            log.info("Duplicate email request ignored eventId={}", eventId);
            return;
        }

        Instant now = clock.instant();
        EmailContent content = composer.compose(request);
        UUID userId = UUID.fromString(request.getUserId());
        if (request.getExpiresAt() != null && !now.isBefore(request.getExpiresAt())) {
            // E.g. after a long outage: a link that no longer works would only confuse the user.
            log.warn("Skipping email with expired link type={} userId={} eventId={}", request.getEmailType(), userId,
                    eventId);
            emailMessages.save(new EmailMessage(eventId, userId, request.getEmail(), request.getEmailType(),
                    content.subject(), EmailStatus.SKIPPED_EXPIRED, now));
            return;
        }

        sender.send(request.getEmail(), content);
        emailMessages.save(new EmailMessage(eventId, userId, request.getEmail(), request.getEmailType(),
                content.subject(), EmailStatus.SENT, now));
        log.info("Account email sent type={} userId={} eventId={}", request.getEmailType(), userId, eventId);
    }
}
