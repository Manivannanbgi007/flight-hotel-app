package com.flighthotel.notification.devseed;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.common.dev.DevIds;
import com.flighthotel.common.dev.DevScenario;
import com.flighthotel.common.dev.DevScenario.Outcome;
import com.flighthotel.common.dev.DevScenario.Person;
import com.flighthotel.common.dev.DevScenario.Stay;
import com.flighthotel.common.dev.DevScenario.Trip;
import com.flighthotel.common.dev.DevSeed;
import com.flighthotel.common.persistence.SecurityAuditorAware;
import com.flighthotel.notification.ticket.SupportTicketRepository;
import com.flighthotel.notification.ticket.SupportTicketSnapshots;

/**
 * <b>Development only</b> ({@code notification.dev-seed.enabled=true}, environment variable {@code DEV_SEED_ENABLED};
 * refuses to run in the {@code prod} profile). In-app notifications (read and unread) for the two development
 * customers, the booking contacts that support tickets refer to, notification preferences, a newsletter subscription,
 * and support tickets in every working state (open, in progress, waiting for the customer, escalated, resolved) with
 * their conversations, assigned to the development support agent where an agent already works on them.
 * <p>
 * Rows are inserted directly. No e-mail is sent, no reminder is scheduled (the {@code upcoming_trips} projection is
 * not filled), no document is generated. Only each new ticket's snapshot is published (the same one every ticket
 * change publishes) so the support search knows the tickets. Rows whose id exists are skipped.
 */
@Component
@Order(20)
@ConditionalOnProperty(prefix = "notification.dev-seed", name = "enabled", havingValue = "true")
public class DevNotificationSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevNotificationSeeder.class);
    private static final String BY = SecurityAuditorAware.SYSTEM;

    /** {@code author}: CUSTOMER or SUPPORT_AGENT; {@code minutesAfterOpen}: when it was written. */
    record Message(String author, String text, long minutesAfterOpen) {
    }

    record TicketDef(String key, String customer, String booking, String category, String subject, String status,
            String priority, boolean assigned, long openedMinutesAgo, List<Message> messages) {
    }

    static final List<TicketDef> TICKETS = List.of(
            new TicketDef("t1", "customer1", "h03", "BOOKING", "Can we check in early on arrival?", "OPEN", "NORMAL",
                    false, 26 * 60L, List.of(new Message("CUSTOMER", "Hello, our flight lands at 9 am. Is it possible "
                            + "to check in around 11 am? We are travelling with a child and would like to rest.", 0))),
            new TicketDef("t2", "customer2", "f03", "CANCELLATION", "I need to move my flight to another day",
                    "IN_PROGRESS", "NORMAL", true, 3 * 24 * 60L, List.of(
                            new Message("CUSTOMER", "Hi, I booked BOM to GOI for this weekend but my niece's school "
                                    + "exam moved. Can I change the date?", 0),
                            new Message("SUPPORT_AGENT", "Hello Priya, flight changes are not self-service for this "
                                    + "fare. I can cancel and refund according to the fare rules, or you can book a new "
                                    + "date. Which would you prefer?", 95),
                            new Message("CUSTOMER", "Please tell me what the cancellation would cost before I decide.",
                                    260))),
            new TicketDef("t3", "customer1", "f05", "REFUND", "Why was a fee taken from my refund?", "RESOLVED",
                    "NORMAL", true, 21 * 24 * 60L, List.of(
                            new Message("CUSTOMER", "I cancelled my Chennai to Bengaluru flight and got back less than "
                                    + "I paid. Can you explain?", 0),
                            new Message("SUPPORT_AGENT", "Your Economy Flex fare keeps 25% of the base fare when you "
                                    + "cancel. Taxes and airline charges were refunded in full. The booking page shows "
                                    + "the breakdown.", 180),
                            new Message("CUSTOMER", "Understood, thank you. I had not read the fare rules.", 400),
                            new Message("SUPPORT_AGENT", "Glad to help. I am marking this as resolved.", 430))),
            new TicketDef("t4", "customer2", "h10", "PAYMENT", "My card payment failed twice", "OPEN", "HIGH", false,
                    6 * 60L, List.of(new Message("CUSTOMER", "The payment for my Goa booking failed twice and the "
                            + "bank says nothing was declined on their side. Please check.", 0))),
            new TicketDef("t5", "customer1", null, "ACCOUNT", "Please update my phone number", "WAITING_CUSTOMER",
                    "NORMAL", true, 5 * 24 * 60L, List.of(
                            new Message("CUSTOMER", "I changed my number and would like my profile updated.", 0),
                            new Message("SUPPORT_AGENT", "Hello Aarav, you can change it yourself under Account > "
                                    + "Profile. If it does not save, tell us which error you see.", 120))),
            new TicketDef("t6", "customer2", "h08", "REFUND", "The hotel cancelled my stay", "ESCALATED", "HIGH", true,
                    2 * 24 * 60L, List.of(
                            new Message("CUSTOMER", "Rajputana Heritage Haveli cancelled my reservation for next month. "
                                    + "When will I get my money back?", 0),
                            new Message("SUPPORT_AGENT", "I am sorry about this. The hotel overbooked. I have "
                                    + "escalated it to be sure the full refund reaches you; it should already show on "
                                    + "the booking page.", 75))));

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final SupportTicketRepository supportTickets;
    private final SupportTicketSnapshots snapshots;
    private final Environment environment;
    private final Clock clock;

    public DevNotificationSeeder(JdbcClient jdbc, TransactionTemplate transactions,
            SupportTicketRepository supportTickets, SupportTicketSnapshots snapshots, Environment environment,
            Clock clock) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.supportTickets = supportTickets;
        this.snapshots = snapshots;
        this.environment = environment;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!DevSeed.allowed(environment, log, "notification-service")) {
            return;
        }
        Instant now = clock.instant();
        LocalDate today = DevScenario.today(clock);
        transactions.executeWithoutResult(status -> contacts(now));
        transactions.executeWithoutResult(status -> notifications(now, today));
        transactions.executeWithoutResult(status -> preferences(now));
        int tickets = 0;
        for (TicketDef ticket : TICKETS) {
            Boolean added = transactions.execute(status -> ticket(ticket, now));
            tickets += Boolean.TRUE.equals(added) ? 1 : 0;
        }
        log.info("Development notifications ready: {} new support tickets, {} in the scenario", tickets, TICKETS.size());
    }

    // ------------------------------------------------------------------ booking contacts

    private void contacts(Instant now) {
        for (Stay stay : DevScenario.STAYS) {
            String[] lead = stay.guests().getFirst();
            contact(stay.bookingId(), stay.person(), stay.reference(), "HOTEL",
                    stay.hotelDef().name() + " · " + stay.nights() + (stay.nights() == 1 ? " night" : " nights")
                            + " · " + stay.rooms() + (stay.rooms() == 1 ? " room" : " rooms"),
                    stay.outcome().paid() ? lead[0] + " " + lead[1] : null, false, stay.bookedAt(now));
        }
        for (Trip trip : DevScenario.TRIPS) {
            var first = trip.people().getFirst();
            contact(trip.bookingId(), trip.person(), trip.reference(), "FLIGHT",
                    trip.title() + " · " + trip.travellers().size()
                            + (trip.travellers().size() == 1 ? " traveller" : " travellers") + " · Economy",
                    trip.outcome().paid() ? first.firstName() + " " + first.lastName() : null, true, trip.bookedAt(now));
        }
    }

    private void contact(UUID bookingId, Person user, String reference, String type, String description, String name,
            boolean demo, Instant booked) {
        jdbc.sql("""
                        INSERT IGNORE INTO booking_contacts (booking_id, user_id, booking_reference, booking_type,
                          description, contact_email, customer_name, demo, updated_at)
                        VALUES (:booking, :user, :reference, :type, :description, :email, :name, :demo, :at)""")
                .param("booking", DevIds.bytes(bookingId)).param("user", DevIds.bytes(user.id()))
                .param("reference", reference).param("type", type).param("description", description)
                .param("email", user.email()).param("name", name).param("demo", demo)
                .param("at", Timestamp.from(booked.plus(12, ChronoUnit.MINUTES))).update();
    }

    // ------------------------------------------------------------------ notifications

    private void notifications(Instant now, LocalDate today) {
        for (Person customer : List.of(DevScenario.CUSTOMER1, DevScenario.CUSTOMER2)) {
            notification(customer, "welcome", "ACCOUNT", "Welcome to FlightHotel",
                    "Hello " + customer.firstName() + ", your account is ready. Search flights and hotels and find all "
                            + "your bookings under My Trips.", "/", now.minus(120, ChronoUnit.DAYS), true);
        }
        for (Stay stay : DevScenario.STAYS) {
            String link = "/my-trips/" + stay.bookingId();
            Instant booked = stay.bookedAt(now);
            String what = stay.hotelDef().name();
            switch (stay.outcome()) {
                case AWAITING_PAYMENT -> notification(stay.person(), stay.key() + "-pay", "BOOKING",
                        "Complete your payment", "Your rooms at " + what + " are held. Pay to confirm booking "
                                + stay.reference() + ".", link + "/pay", booked.plus(1, ChronoUnit.MINUTES), false);
                case PAYMENT_FAILED -> notification(stay.person(), stay.key() + "-failed", "PAYMENT",
                        "Payment failed", "Your payment for " + what + " did not go through. You can try again from "
                                + "your booking.", link + "/pay", booked.plus(10, ChronoUnit.MINUTES), false);
                case CONFIRMED, IN_HOUSE -> notification(stay.person(), stay.key() + "-confirmed", "BOOKING",
                        "Booking confirmed", "Your stay at " + what + " is confirmed. Confirmation number "
                                + stay.confirmationNumber() + ".", link, booked.plus(12, ChronoUnit.MINUTES),
                        stay.checkInOffset() < 0);
                case COMPLETED -> notification(stay.person(), stay.key() + "-completed", "BOOKING",
                        "How was your stay?", "Your stay at " + what + " is over. Tell other guests about it with a "
                                + "review.", link, stay.checkOut(today).atTime(12, 0).atZone(DevScenario.INDIA).toInstant(),
                        true);
                case CANCELLED_REFUNDED, CANCELLED_PARTIAL, CANCELLED_BY_HOTEL -> notification(stay.person(),
                        stay.key() + "-refund", "REFUND", "Refund completed",
                        "Your refund of ₹" + stay.refund().toPlainString() + " for " + what + " has been "
                                + "processed.", link, stay.cancelledAt(now, today).plus(10, ChronoUnit.MINUTES),
                        stay.outcome() != Outcome.CANCELLED_BY_HOTEL);
                default -> {
                    // No-show: nothing to tell the customer.
                }
            }
        }
        for (Trip trip : DevScenario.TRIPS) {
            String link = "/my-trips/" + trip.bookingId();
            Instant booked = trip.bookedAt(now);
            switch (trip.outcome()) {
                case AWAITING_PAYMENT -> notification(trip.person(), trip.key() + "-pay", "BOOKING",
                        "Complete your payment", "Your seats on " + trip.title() + " are held. Pay to confirm booking "
                                + trip.reference() + ".", link + "/pay", booked.plus(1, ChronoUnit.MINUTES), false);
                case PAYMENT_FAILED -> notification(trip.person(), trip.key() + "-failed", "PAYMENT",
                        "Payment failed", "Your payment for " + trip.title() + " did not go through. You can try "
                                + "again from your booking.", link + "/pay", booked.plus(10, ChronoUnit.MINUTES), false);
                case CONFIRMED, COMPLETED -> notification(trip.person(), trip.key() + "-confirmed", "BOOKING",
                        "Booking confirmed", "Your flight " + trip.title() + " is confirmed. PNR " + trip.pnr() + ".",
                        link, booked.plus(12, ChronoUnit.MINUTES), trip.outcome() == Outcome.COMPLETED);
                case CANCELLED_PARTIAL -> notification(trip.person(), trip.key() + "-refund", "REFUND",
                        "Refund completed", "Your refund of ₹" + trip.refund().toPlainString() + " for "
                                + trip.title() + " has been processed.", link,
                        trip.cancelledAt(today).plus(10, ChronoUnit.MINUTES), true);
                default -> {
                    // Not used for flights.
                }
            }
        }
        // A reminder that is already in the bell (the reminder e-mail itself is never sent from seed data).
        Trip soon = DevScenario.trip("f03");
        notification(soon.person(), "f03-reminder", "REMINDER", "Your trip starts soon",
                "Your flight " + soon.title() + " departs in three days. Check your documents and baggage allowance.",
                "/my-trips/" + soon.bookingId(), now.minus(3, ChronoUnit.HOURS), false);
        notification(DevScenario.CUSTOMER2, "t2-reply", "SUPPORT", "New answer from support",
                "Support replied to your ticket \"I need to move my flight to another day\".", "/support",
                now.minus(3 * 24 * 60L - 95, ChronoUnit.MINUTES), false);
    }

    private void notification(Person user, String key, String category, String title, String message, String link,
            Instant at, boolean read) {
        jdbc.sql("""
                        INSERT IGNORE INTO notifications (id, user_id, category, title, message, link, source_event_id,
                          read_at, created_at)
                        VALUES (:id, :user, :category, :title, :message, :link, :source, :read, :at)""")
                .param("id", DevIds.bytes(DevIds.of("notification", user.key() + ":" + key)))
                .param("user", DevIds.bytes(user.id())).param("category", category).param("title", title)
                .param("message", message.length() > 500 ? message.substring(0, 500) : message).param("link", link)
                .param("source", "dev-seed:" + user.key() + ":" + key)
                .param("read", read ? Timestamp.from(at.plus(2, ChronoUnit.HOURS)) : null)
                .param("at", Timestamp.from(at)).update();
    }

    private void preferences(Instant now) {
        // customer2 does not want reminder e-mails (the bell stays on); customer1 reads the newsletter.
        jdbc.sql("""
                        INSERT IGNORE INTO notification_preferences (user_id, category, channel, enabled, updated_at)
                        VALUES (:user, 'REMINDER', 'EMAIL', FALSE, :now)""")
                .param("user", DevIds.bytes(DevScenario.CUSTOMER2.id())).param("now", Timestamp.from(now)).update();
        Person c1 = DevScenario.CUSTOMER1;
        jdbc.sql("""
                        INSERT IGNORE INTO newsletter_subscriptions (id, email, status, user_id, source, created_at,
                          confirmed_at, updated_at, version)
                        VALUES (:id, :email, 'SUBSCRIBED', :user, 'ACCOUNT', :at, :at, :at, 0)""")
                .param("id", DevIds.bytes(DevIds.of("newsletter", c1.key()))).param("email", c1.email())
                .param("user", DevIds.bytes(c1.id())).param("at", Timestamp.from(now.minus(100, ChronoUnit.DAYS))).update();
    }

    // ------------------------------------------------------------------ support tickets

    private boolean ticket(TicketDef def, Instant now) {
        UUID id = DevIds.of("ticket", def.key());
        if (jdbc.sql("SELECT COUNT(*) FROM support_tickets WHERE id = :id").param("id", DevIds.bytes(id))
                .query(Long.class).single() > 0) {
            return false;
        }
        Person customer = DevScenario.person(def.customer());
        Instant opened = now.minus(def.openedMinutesAgo(), ChronoUnit.MINUTES);
        List<Instant> times = new ArrayList<>();
        def.messages().forEach(m -> times.add(opened.plus(m.minutesAfterOpen(), ChronoUnit.MINUTES)));
        Message last = def.messages().getLast();
        Instant lastAt = times.getLast();
        boolean resolved = def.status().equals("RESOLVED");
        String reference = def.booking() == null ? null : reference(def.booking());
        UUID bookingId = def.booking() == null ? null : DevIds.of("booking", def.booking());
        jdbc.sql("""
                        INSERT INTO support_tickets (id, ticket_number, user_id, customer_email, booking_id,
                          booking_reference, subject, category, status, priority, assigned_agent_id, assigned_at,
                          last_message_at, last_message_by, closed_at, resolved_at, created_at, updated_at, created_by,
                          updated_by, version)
                        VALUES (:id, :number, :user, :email, :booking, :reference, :subject, :category, :status, :priority,
                          :agent, :assignedAt, :lastAt, :lastBy, NULL, :resolvedAt, :opened, :lastAt, :by, :by, 0)""")
                .param("id", DevIds.bytes(id)).param("number", DevIds.code("TK-", def.key(), 8))
                .param("user", DevIds.bytes(customer.id())).param("email", customer.email())
                .param("booking", bookingId == null ? null : DevIds.bytes(bookingId)).param("reference", reference)
                .param("subject", def.subject()).param("category", def.category()).param("status", def.status())
                .param("priority", def.priority())
                .param("agent", def.assigned() ? DevIds.bytes(DevScenario.SUPPORT1.id()) : null)
                .param("assignedAt", def.assigned() ? Timestamp.from(times.size() > 1 ? times.get(1) : opened) : null)
                .param("lastAt", Timestamp.from(lastAt)).param("lastBy", last.author().equals("CUSTOMER") ? "CUSTOMER"
                        : "SUPPORT")
                .param("resolvedAt", resolved ? Timestamp.from(lastAt) : null).param("opened", Timestamp.from(opened))
                .param("by", customer.id().toString()).update();
        for (int i = 0; i < def.messages().size(); i++) {
            Message message = def.messages().get(i);
            boolean agent = message.author().equals("SUPPORT_AGENT");
            jdbc.sql("""
                            INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_role, message, created_at)
                            VALUES (:id, :ticket, :author, :role, :text, :at)""")
                    .param("id", DevIds.bytes(DevIds.of("ticket-message", def.key() + ":" + i)))
                    .param("ticket", DevIds.bytes(id))
                    .param("author", (agent ? DevScenario.SUPPORT1 : customer).id().toString())
                    .param("role", agent ? "SUPPORT_AGENT" : "CUSTOMER").param("text", message.text())
                    .param("at", Timestamp.from(times.get(i))).update();
        }
        supportTickets.findById(id).ifPresent(snapshots::publish);
        return true;
    }

    private static String reference(String bookingKey) {
        return DevScenario.STAYS.stream().filter(s -> s.key().equals(bookingKey)).map(Stay::reference).findFirst()
                .orElseGet(() -> DevScenario.trip(bookingKey).reference());
    }
}
