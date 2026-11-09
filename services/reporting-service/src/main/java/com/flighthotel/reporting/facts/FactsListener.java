package com.flighthotel.reporting.facts;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.booking.BookingSnapshot;
import com.flighthotel.events.identity.EmailVerified;
import com.flighthotel.events.identity.UserProfileUpdated;
import com.flighthotel.events.identity.UserRegistered;
import com.flighthotel.events.identity.UserRolesChanged;
import com.flighthotel.events.identity.UserSnapshot;
import com.flighthotel.events.identity.UserStatusChanged;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.events.payment.RefundFailed;

/**
 * Builds the reporting facts from the other services' events. Own consumer groups: when reporting-service first starts
 * they read the topics from the beginning (Kafka keeps 7 days; bookings and accounts older than that come from the
 * one-time snapshot backfills of booking- and identity-service). No inbox is needed: every write is an idempotent
 * upsert ({@link FactStore}).
 */
@Component
public class FactsListener {

    static final String BOOKINGS = "reporting-facts-bookings";
    static final String PAYMENTS = "reporting-facts-payments";
    static final String ACCOUNTS = "reporting-facts-accounts";

    private final FactStore facts;
    private final DashboardUpdates updates;

    public FactsListener(FactStore facts, DashboardUpdates updates) {
        this.facts = facts;
        this.updates = updates;
    }

    @KafkaListener(id = BOOKINGS, groupId = BOOKINGS, topics = "booking.events")
    public void onBookingEvent(ConsumerRecord<String, Object> record) {
        handle(record.value());
    }

    @KafkaListener(id = PAYMENTS, groupId = PAYMENTS, topics = "payment.events")
    public void onPaymentEvent(ConsumerRecord<String, Object> record) {
        handle(record.value());
    }

    @KafkaListener(id = ACCOUNTS, groupId = ACCOUNTS, topics = "identity.events")
    public void onIdentityEvent(ConsumerRecord<String, Object> record) {
        handle(record.value());
    }

    /** Also called directly by tests. */
    public void handle(Object event) {
        boolean changed = switch (event) {
            case BookingSnapshot snapshot -> facts.booking(snapshot);
            case BookingCancelled cancelled -> facts.cancelled(cancelled);
            case BookingRefundRequested refund -> facts.refundRequested(refund);
            case PaymentSucceeded payment -> facts.paymentSucceeded(payment);
            case PaymentFailed payment -> facts.paymentFailed(payment);
            case RefundCompleted refund -> facts.refundCompleted(refund);
            case RefundFailed refund -> facts.refundFailed(refund);
            case UserSnapshot user -> facts.user(user);
            case UserRegistered user -> facts.userRegistered(user);
            case EmailVerified verified -> facts.emailVerified(verified);
            case UserStatusChanged status -> facts.statusChanged(status);
            case UserRolesChanged roles -> facts.rolesChanged(roles);
            case UserProfileUpdated profile -> facts.profileUpdated(profile);
            default -> false;   // saga messages the reports do not need
        };
        if (changed) {
            updates.changed();
        }
    }
}
