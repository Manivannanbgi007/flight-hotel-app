package com.flighthotel.notification.reminder;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.notification.email.BookingEmailComposer;
import com.flighthotel.notification.email.EmailContent;
import com.flighthotel.notification.email.EmailSender;
import com.flighthotel.notification.entity.EmailMessage;
import com.flighthotel.notification.entity.EmailMessage.EmailStatus;
import com.flighthotel.notification.preference.NotificationPreferences;
import com.flighthotel.notification.preference.NotificationPreferences.Category;
import com.flighthotel.notification.preference.NotificationPreferences.Channel;
import com.flighthotel.notification.projection.UpcomingTrips;
import com.flighthotel.notification.projection.UpcomingTrips.Trip;
import com.flighthotel.notification.repository.EmailMessageRepository;
import com.flighthotel.notification.service.NotificationService;

/**
 * Travel reminders (BOOKING_WORKFLOW.md section 6): 24 hours before check-in or the first departure, a bell entry and an
 * e-mail, each as the customer's preferences allow. Each trip in its own transaction with a row lock, so several
 * instances can run the job and a trip is reminded once; cancelled trips are never reminded.
 */
@Service
public class TravelReminders {

    private static final Logger log = LoggerFactory.getLogger(TravelReminders.class);
    private static final int BATCH = 100;

    private final UpcomingTrips trips;
    private final NotificationService notifications;
    private final NotificationPreferences preferences;
    private final BookingEmailComposer composer;
    private final EmailSender sender;
    private final EmailMessageRepository emailMessages;
    private final TransactionTemplate transactions;
    private final Duration leadTime;
    private final Clock clock;

    public TravelReminders(UpcomingTrips trips, NotificationService notifications, NotificationPreferences preferences,
            BookingEmailComposer composer, EmailSender sender, EmailMessageRepository emailMessages,
            TransactionTemplate transactions, @Value("${notification.reminders.lead-time:24h}") Duration leadTime,
            Clock clock) {
        this.trips = trips;
        this.notifications = notifications;
        this.preferences = preferences;
        this.composer = composer;
        this.sender = sender;
        this.emailMessages = emailMessages;
        this.transactions = transactions;
        this.leadTime = leadTime;
        this.clock = clock;
    }

    /** @return how many reminders went out */
    @Scheduled(fixedDelayString = "${notification.reminders.interval:15m}", initialDelayString = "PT1M")
    public int sendDueReminders() {
        Instant now = clock.instant();
        List<UUID> due = trips.due(now, now.plus(leadTime), BATCH);
        int sent = 0;
        for (UUID bookingId : due) {
            try {
                Boolean done = transactions.execute(status -> remind(bookingId));
                if (Boolean.TRUE.equals(done)) {
                    sent++;
                }
            } catch (RuntimeException ex) {
                // E.g. the mail server is down: the next run tries again (the trip is still not reminded).
                log.warn("Travel reminder failed bookingId={} error={}", bookingId, ex.toString());
            }
        }
        if (sent > 0) {
            log.info("Travel reminders sent: {}", sent);
        }
        return sent;
    }

    /** Runs inside the job's per-trip transaction. */
    boolean remind(UUID bookingId) {
        Trip trip = trips.lockDue(bookingId).orElse(null);
        if (trip == null) {
            return false;
        }
        Instant now = clock.instant();
        String source = UUID.nameUUIDFromBytes(("REMINDER:" + bookingId).getBytes(StandardCharsets.UTF_8)).toString();
        boolean flight = "FLIGHT".equals(trip.bookingType());
        notifications.create(trip.userId(), "REMINDER", flight ? "Your flight is tomorrow" : "Your stay starts tomorrow",
                trip.title() + " · booking " + trip.bookingReference() + ". Have a good trip!",
                "/my-trips/" + bookingId, source);
        if (preferences.enabled(trip.userId(), Category.REMINDER, Channel.EMAIL)) {
            EmailContent content = composer.travelReminder(bookingId.toString(), trip.bookingReference(),
                    trip.bookingType(), trip.title(), trip.customerName(), trip.details().stream()
                            .map(row -> new BookingEmailComposer.Row(row.label(), row.value())).toList());
            sender.send(trip.contactEmail(), content);
            emailMessages.save(new EmailMessage(source, trip.userId(), trip.contactEmail(), "TRAVEL_REMINDER",
                    content.subject(), EmailStatus.SENT, now));
        }
        trips.reminderSent(bookingId, now);
        log.info("Travel reminder sent bookingId={} startsAt={}", bookingId, trip.startsAt());
        return true;
    }
}
