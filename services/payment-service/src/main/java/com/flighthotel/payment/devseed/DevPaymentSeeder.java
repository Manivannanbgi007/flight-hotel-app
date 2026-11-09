package com.flighthotel.payment.devseed;

import java.math.BigDecimal;
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

/**
 * <b>Development only</b> ({@code payment.dev-seed.enabled=true}, environment variable {@code DEV_SEED_ENABLED};
 * refuses to run in the {@code prod} profile). The payments of the development bookings, for the DEMO provider only:
 * the amount each booking waits for, successful, failed, refunded and partly refunded payment attempts, their refunds
 * and the invoices. No provider is called and no event is sent, so nobody is charged or e-mailed.
 * <p>
 * An attempt that is still open ({@code INITIATED}/{@code PENDING}) is deliberately not seeded: the reconciliation
 * job would close it after an hour and tell booking-service. Bookings that wait for payment simply have no attempt yet;
 * paying them with the demo checkout works as for any new booking. Invoice numbers use the series {@code INV/DEV/...},
 * which never collides with the real {@code INV/<year>/...} numbers. Rows with an existing id are skipped.
 */
@Component
@Order(20)
@ConditionalOnProperty(prefix = "payment.dev-seed", name = "enabled", havingValue = "true")
public class DevPaymentSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevPaymentSeeder.class);
    private static final String BY = SecurityAuditorAware.SYSTEM;
    private static final String[] METHODS = {"card", "upi", "netbanking"};
    private static final String DOT = "·";

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final Environment environment;
    private final Clock clock;

    public DevPaymentSeeder(JdbcClient jdbc, TransactionTemplate transactions, Environment environment, Clock clock) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.environment = environment;
        this.clock = clock;
    }

    /** One booking as payment-service sees it. */
    private record Unit(String key, UUID bookingId, UUID paymentId, String reference, String type, Person user,
            BigDecimal subtotal, BigDecimal taxes, BigDecimal total, BigDecimal refund, String description,
            Outcome outcome, Instant booked, Instant cancelledAt) {
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!DevSeed.allowed(environment, log, "payment-service")) {
            return;
        }
        Instant now = clock.instant();
        LocalDate today = DevScenario.today(clock);
        List<Unit> units = new ArrayList<>();
        for (Stay stay : DevScenario.STAYS) {
            var price = stay.price();
            units.add(new Unit(stay.key(), stay.bookingId(), stay.paymentId(), stay.reference(), "HOTEL", stay.person(),
                    price.subtotal(), price.taxes(), price.total(), stay.refund(),
                    stay.hotelDef().name() + " " + DOT + " " + stay.nights() + (stay.nights() == 1 ? " night" : " nights")
                            + " " + DOT + " " + stay.rooms() + (stay.rooms() == 1 ? " room" : " rooms"),
                    stay.outcome(), stay.bookedAt(now), stay.cancelledAt(now, today)));
        }
        for (Trip trip : DevScenario.TRIPS) {
            var price = trip.price();
            int travellers = trip.travellers().size();
            units.add(new Unit(trip.key(), trip.bookingId(), trip.paymentId(), trip.reference(), "FLIGHT", trip.person(),
                    price.subtotal(), price.taxes(), price.total(), trip.refund(),
                    trip.title() + " " + DOT + " " + travellers + (travellers == 1 ? " traveller" : " travellers") + " "
                            + DOT + " Economy",
                    trip.outcome(), trip.bookedAt(now), trip.cancelledAt(today)));
        }
        int created = 0;
        for (Unit unit : units) {
            Boolean added = transactions.execute(status -> seed(unit, now));
            created += Boolean.TRUE.equals(added) ? 1 : 0;
        }
        log.info("Development payments ready: {} new bookings seeded, {} in the scenario", created, units.size());
    }

    private boolean seed(Unit unit, Instant now) {
        if (jdbc.sql("SELECT COUNT(*) FROM payable_bookings WHERE booking_id = :id")
                .param("id", DevIds.bytes(unit.bookingId())).query(Long.class).single() > 0) {
            return false;
        }
        Outcome outcome = unit.outcome();
        Instant booked = unit.booked();
        Instant deadline = outcome.held() ? now.plus(DevScenario.PENDING_HOLD).minus(5, ChronoUnit.MINUTES)
                : booked.plus(15, ChronoUnit.MINUTES);
        jdbc.sql("""
                        INSERT INTO payable_bookings (booking_id, booking_reference, booking_type, user_id, amount, currency,
                          description, contact_email, status, payment_deadline, created_at, updated_at, created_by,
                          updated_by, version)
                        VALUES (:id, :reference, :type, :user, :amount, 'INR', :description, :email, :status, :deadline,
                          :created, :updated, :by, :by, 0)""")
                .param("id", DevIds.bytes(unit.bookingId())).param("reference", unit.reference())
                .param("type", unit.type()).param("user", DevIds.bytes(unit.user().id())).param("amount", unit.total())
                .param("description", unit.description()).param("email", unit.user().email())
                .param("status", outcome.held() ? "AWAITING_PAYMENT" : "PAID").param("deadline", Timestamp.from(deadline))
                .param("created", Timestamp.from(booked.plus(1, ChronoUnit.MINUTES)))
                .param("updated", Timestamp.from(booked.plus(outcome.held() ? 1 : 12, ChronoUnit.MINUTES)))
                .param("by", BY).update();
        if (outcome == Outcome.AWAITING_PAYMENT) {
            return true;
        }
        boolean failed = outcome == Outcome.PAYMENT_FAILED;
        String status = failed ? "FAILED" : outcome == Outcome.CANCELLED_PARTIAL ? "PARTIALLY_REFUNDED"
                : outcome.cancelled() ? "REFUNDED" : "SUCCESS";
        String method = METHODS[Math.floorMod(unit.key().hashCode(), METHODS.length)];
        Instant paidAt = booked.plus(10, ChronoUnit.MINUTES);
        jdbc.sql("""
                        INSERT INTO payment_transactions (id, booking_id, user_id, provider, provider_order_id,
                          provider_payment_id, amount, refunded_amount, currency, status, method, failure_code,
                          failure_message, idempotency_key, verified_at, created_at, updated_at, created_by, updated_by,
                          version)
                        VALUES (:id, :booking, :user, 'DEMO', :order, :payment, :amount, :refunded, 'INR', :status, :method,
                          :code, :message, :key, :verified, :created, :updated, :by, :by, 0)""")
                .param("id", DevIds.bytes(unit.paymentId())).param("booking", DevIds.bytes(unit.bookingId()))
                .param("user", DevIds.bytes(unit.user().id()))
                .param("order", "order_demo_" + DevIds.hex(unit.key() + ":order", 14))
                .param("payment", (failed ? "pay_demo_fail_" : "pay_demo_ok_") + DevIds.hex(unit.key() + ":pay", 14))
                .param("amount", unit.total()).param("refunded", unit.refund()).param("status", status)
                .param("method", method).param("code", failed ? "DEMO_DECLINED" : null)
                .param("message", failed ? "The demo payment was declined (Fail button)." : null)
                .param("key", "dev-pay-" + unit.key()).param("verified", failed ? null : Timestamp.from(paidAt))
                .param("created", Timestamp.from(booked.plus(2, ChronoUnit.MINUTES)))
                .param("updated", Timestamp.from(unit.cancelledAt() != null ? unit.cancelledAt().plus(10, ChronoUnit.MINUTES)
                        : paidAt))
                .param("by", BY).update();
        if (failed) {
            return true;
        }
        if (outcome.cancelled()) {
            jdbc.sql("""
                            INSERT INTO refunds (id, payment_id, booking_id, user_id, amount, currency, status,
                              provider_refund_id, reason, idempotency_key, created_at, updated_at, created_by, updated_by,
                              version)
                            VALUES (:id, :payment, :booking, :user, :amount, 'INR', 'PROCESSED', :providerRefund,
                              'CANCELLATION', :key, :created, :updated, :by, :by, 0)""")
                    .param("id", DevIds.bytes(DevIds.of("refund", unit.key())))
                    .param("payment", DevIds.bytes(unit.paymentId())).param("booking", DevIds.bytes(unit.bookingId()))
                    .param("user", DevIds.bytes(unit.user().id())).param("amount", unit.refund())
                    .param("providerRefund", "rfnd_demo_" + DevIds.hex(unit.key() + ":refund", 14))
                    .param("key", DevIds.of("refund-request", unit.key()).toString())
                    .param("created", Timestamp.from(unit.cancelledAt().plus(3, ChronoUnit.MINUTES)))
                    .param("updated", Timestamp.from(unit.cancelledAt().plus(10, ChronoUnit.MINUTES)))
                    .param("by", BY).update();
        }
        int number = units().indexOf(unit.key()) + 1;
        jdbc.sql("""
                        INSERT INTO invoices (id, invoice_number, booking_id, booking_reference, payment_id, user_id,
                          billing_name, billing_email, description, currency, taxable_amount, tax_amount, discount_amount,
                          total_amount, issued_at)
                        VALUES (:id, :number, :booking, :reference, :payment, :user, :name, :email, :description, 'INR',
                          :taxable, :tax, 0, :total, :issued)""")
                .param("id", DevIds.bytes(DevIds.of("invoice", unit.key())))
                .param("number", String.format("INV/DEV/%06d", number)).param("booking", DevIds.bytes(unit.bookingId()))
                .param("reference", unit.reference()).param("payment", DevIds.bytes(unit.paymentId()))
                .param("user", DevIds.bytes(unit.user().id())).param("name", unit.user().fullName())
                .param("email", unit.user().email()).param("description", unit.description())
                .param("taxable", unit.subtotal()).param("tax", unit.taxes()).param("total", unit.total())
                .param("issued", Timestamp.from(booked.plus(13, ChronoUnit.MINUTES))).update();
        return true;
    }

    /** The scenario's booking keys in a fixed order: the invoice number is the position (stable on every run). */
    private static List<String> units() {
        List<String> keys = new ArrayList<>();
        DevScenario.STAYS.forEach(s -> keys.add(s.key()));
        DevScenario.TRIPS.forEach(t -> keys.add(t.key()));
        return keys;
    }
}
