package com.flighthotel.reporting.facts;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.events.EventMoney;
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
 * Writes the facts the dashboard and reports read (V4 migration). Every write is an upsert keyed by the business id and
 * never moves a fact backwards (an older snapshot, a "requested" after a "completed"), so events may arrive twice, be
 * replayed by a new consumer group, or come from two topics in any order.
 *
 * @see FactsListener
 */
@Component
public class FactStore {

    private final JdbcClient jdbc;
    private final Clock clock;

    public FactStore(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ bookings

    /** The latest snapshot wins; an older one (replay, redelivery) is ignored. @return true if it was newer */
    @Transactional
    public boolean booking(BookingSnapshot s) {
        int changed = jdbc.sql("""
                        INSERT INTO booking_facts (booking_id, booking_reference, user_id, booking_type, status,
                            payment_status, title, destination, hotel_id, route_origin, route_destination, origin_city,
                            start_date, end_date, currency, total_amount, discount_amount, refunded_amount,
                            contact_email, coupon_code, created_at, confirmed_at, cancelled_at, demo, changed_at,
                            received_at)
                        VALUES (UUID_TO_BIN(:id), :reference, UUID_TO_BIN(:userId), :type, :status, :paymentStatus,
                            :title, :destination, UUID_TO_BIN(:hotelId), :routeOrigin, :routeDestination, :originCity,
                            :startDate, :endDate, :currency, :total, :discount, :refunded, :email, :coupon, :createdAt,
                            :confirmedAt, :cancelledAt, :demo, :changedAt, :now)
                        ON DUPLICATE KEY UPDATE
                            status = IF(VALUES(changed_at) >= changed_at, VALUES(status), status),
                            payment_status = IF(VALUES(changed_at) >= changed_at, VALUES(payment_status), payment_status),
                            title = IF(VALUES(changed_at) >= changed_at, VALUES(title), title),
                            destination = IF(VALUES(changed_at) >= changed_at, VALUES(destination), destination),
                            hotel_id = IF(VALUES(changed_at) >= changed_at, VALUES(hotel_id), hotel_id),
                            route_origin = IF(VALUES(changed_at) >= changed_at, VALUES(route_origin), route_origin),
                            route_destination = IF(VALUES(changed_at) >= changed_at, VALUES(route_destination),
                                route_destination),
                            origin_city = IF(VALUES(changed_at) >= changed_at, VALUES(origin_city), origin_city),
                            start_date = IF(VALUES(changed_at) >= changed_at, VALUES(start_date), start_date),
                            end_date = IF(VALUES(changed_at) >= changed_at, VALUES(end_date), end_date),
                            currency = IF(VALUES(changed_at) >= changed_at, VALUES(currency), currency),
                            total_amount = IF(VALUES(changed_at) >= changed_at, VALUES(total_amount), total_amount),
                            discount_amount = IF(VALUES(changed_at) >= changed_at, VALUES(discount_amount),
                                discount_amount),
                            refunded_amount = IF(VALUES(changed_at) >= changed_at, VALUES(refunded_amount),
                                refunded_amount),
                            coupon_code = IF(VALUES(changed_at) >= changed_at, VALUES(coupon_code), coupon_code),
                            confirmed_at = IF(VALUES(changed_at) >= changed_at, VALUES(confirmed_at), confirmed_at),
                            cancelled_at = IF(VALUES(changed_at) >= changed_at, VALUES(cancelled_at), cancelled_at),
                            demo = IF(VALUES(changed_at) >= changed_at, VALUES(demo), demo),
                            received_at = IF(VALUES(changed_at) >= changed_at, VALUES(received_at), received_at),
                            changed_at = GREATEST(changed_at, VALUES(changed_at))""")
                .param("id", s.getBookingId())
                .param("reference", s.getBookingReference())
                .param("userId", s.getUserId())
                .param("type", s.getBookingType())
                .param("status", s.getStatus())
                .param("paymentStatus", s.getPaymentStatus())
                .param("title", s.getTitle())
                .param("destination", s.getDestination())
                .param("hotelId", s.getHotelId())
                .param("routeOrigin", s.getRouteOrigin())
                .param("routeDestination", s.getRouteDestination())
                .param("originCity", s.getOriginCity())
                .param("startDate", s.getStartDate())
                .param("endDate", s.getEndDate())
                .param("currency", s.getTotalAmount().getCurrency())
                .param("total", EventMoney.amount(s.getTotalAmount()))
                .param("discount", EventMoney.amount(s.getDiscountAmount()))
                .param("refunded", EventMoney.amount(s.getRefundedAmount()))
                .param("email", s.getContactEmail())
                .param("coupon", s.getCouponCode())
                .param("createdAt", utc(s.getCreatedAt()))
                .param("confirmedAt", utc(s.getConfirmedAt()))
                .param("cancelledAt", utc(s.getCancelledAt()))
                .param("demo", s.getDemo())
                .param("changedAt", utc(s.getChangedAt()))
                .param("now", utc(clock.instant()))
                .update();
        return changed > 0;
    }

    @Transactional
    public boolean cancelled(BookingCancelled c) {
        return jdbc.sql("""
                        INSERT IGNORE INTO cancellation_facts (cancellation_id, booking_id, booking_reference,
                            booking_type, title, initiated_by, currency, paid_amount, cancellation_fee, refund_amount,
                            fee_waived, cancelled_at, received_at)
                        VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:bookingId), :reference, :type, :title, :initiatedBy,
                            :currency, :paid, :fee, :refund, :waived, :cancelledAt, :now)""")
                .param("id", c.getCancellationId())
                .param("bookingId", c.getBookingId())
                .param("reference", c.getBookingReference())
                .param("type", c.getBookingType())
                .param("title", c.getTitle())
                .param("initiatedBy", c.getInitiatedBy())
                .param("currency", c.getPaidAmount().getCurrency())
                .param("paid", EventMoney.amount(c.getPaidAmount()))
                .param("fee", EventMoney.amount(c.getCancellationFee()))
                .param("refund", EventMoney.amount(c.getRefundAmount()))
                .param("waived", c.getFeeWaived())
                .param("cancelledAt", utc(c.getCancelledAt()))
                .param("now", utc(clock.instant()))
                .update() > 0;
    }

    // ------------------------------------------------------------------ payments and refunds

    /** Captured money. SUCCESS is final: a late "failed" for the same attempt never undoes it. */
    @Transactional
    public boolean paymentSucceeded(PaymentSucceeded p) {
        return jdbc.sql("""
                        INSERT INTO payment_facts (payment_id, booking_id, user_id, provider, method, status, amount,
                            currency, failure_code, occurred_at, received_at)
                        VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:bookingId), UUID_TO_BIN(:userId), :provider, :method,
                            'SUCCESS', :amount, :currency, NULL, :at, :now)
                        ON DUPLICATE KEY UPDATE
                            amount = IF(status = 'SUCCESS', amount, VALUES(amount)),
                            currency = IF(status = 'SUCCESS', currency, VALUES(currency)),
                            method = IF(status = 'SUCCESS', method, VALUES(method)),
                            failure_code = IF(status = 'SUCCESS', failure_code, NULL),
                            occurred_at = IF(status = 'SUCCESS', occurred_at, VALUES(occurred_at)),
                            status = 'SUCCESS'""")
                .param("id", p.getPaymentId())
                .param("bookingId", p.getBookingId())
                .param("userId", p.getUserId())
                .param("provider", p.getProvider())
                .param("method", p.getMethod())
                .param("amount", EventMoney.amount(p.getAmount()))
                .param("currency", p.getAmount().getCurrency())
                .param("at", utc(p.getSucceededAt()))
                .param("now", utc(clock.instant()))
                .update() > 0;
    }

    @Transactional
    public boolean paymentFailed(PaymentFailed p) {
        return jdbc.sql("""
                        INSERT INTO payment_facts (payment_id, booking_id, user_id, provider, method, status, amount,
                            currency, failure_code, occurred_at, received_at)
                        VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:bookingId), UUID_TO_BIN(:userId), :provider, NULL,
                            'FAILED', NULL, NULL, :code, :at, :now)
                        ON DUPLICATE KEY UPDATE
                            failure_code = IF(status = 'SUCCESS', failure_code, VALUES(failure_code)),
                            occurred_at = IF(status = 'SUCCESS', occurred_at, VALUES(occurred_at))""")
                .param("id", p.getPaymentId())
                .param("bookingId", p.getBookingId())
                .param("userId", p.getUserId())
                .param("provider", p.getProvider())
                .param("code", p.getFailureCode())
                .param("at", utc(p.getFailedAt()))
                .param("now", utc(clock.instant()))
                .update() > 0;
    }

    /** The request; an answer that arrived first (other topic) keeps its status. */
    @Transactional
    public boolean refundRequested(BookingRefundRequested r) {
        return jdbc.sql("""
                        INSERT INTO refund_facts (refund_request_id, booking_id, booking_reference, payment_id, amount,
                            currency, reason, status, requested_at, received_at)
                        VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:bookingId), :reference, UUID_TO_BIN(:paymentId),
                            :amount, :currency, :reason, 'REQUESTED', :at, :now)
                        ON DUPLICATE KEY UPDATE booking_reference = VALUES(booking_reference),
                            reason = VALUES(reason), requested_at = VALUES(requested_at)""")
                .param("id", r.getRefundRequestId())
                .param("bookingId", r.getBookingId())
                .param("reference", r.getBookingReference())
                .param("paymentId", r.getPaymentId())
                .param("amount", EventMoney.amount(r.getAmount()))
                .param("currency", r.getAmount().getCurrency())
                .param("reason", r.getReason())
                .param("at", utc(r.getRequestedAt()))
                .param("now", utc(clock.instant()))
                .update() > 0;
    }

    /** payment-service repeats its answer when asked again: the first completion time is kept. */
    @Transactional
    public boolean refundCompleted(RefundCompleted r) {
        return jdbc.sql("""
                        INSERT INTO refund_facts (refund_request_id, booking_id, payment_id, amount, currency, status,
                            completed_at, received_at)
                        VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:bookingId), UUID_TO_BIN(:paymentId), :amount, :currency,
                            'COMPLETED', :at, :now)
                        ON DUPLICATE KEY UPDATE completed_at = COALESCE(completed_at, VALUES(completed_at)),
                            status = 'COMPLETED'""")
                .param("id", r.getRefundRequestId())
                .param("bookingId", r.getBookingId())
                .param("paymentId", r.getPaymentId())
                .param("amount", EventMoney.amount(r.getAmount()))
                .param("currency", r.getAmount().getCurrency())
                .param("at", utc(r.getCompletedAt()))
                .param("now", utc(clock.instant()))
                .update() > 0;
    }

    @Transactional
    public boolean refundFailed(RefundFailed r) {
        return jdbc.sql("""
                        INSERT INTO refund_facts (refund_request_id, booking_id, payment_id, amount, currency, status,
                            failed_at, failure_reason, received_at)
                        VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:bookingId), UUID_TO_BIN(:paymentId), :amount, :currency,
                            'FAILED', :at, :reason, :now)
                        ON DUPLICATE KEY UPDATE
                            failure_reason = IF(status = 'COMPLETED', failure_reason, VALUES(failure_reason)),
                            failed_at = IF(status = 'COMPLETED', failed_at, COALESCE(failed_at, VALUES(failed_at))),
                            status = IF(status = 'COMPLETED', status, 'FAILED')""")
                .param("id", r.getRefundRequestId())
                .param("bookingId", r.getBookingId())
                .param("paymentId", r.getPaymentId())
                .param("amount", EventMoney.amount(r.getAmount()))
                .param("currency", r.getAmount().getCurrency())
                .param("at", utc(r.getFailedAt()))
                .param("reason", limit(r.getReason(), 255))
                .param("now", utc(clock.instant()))
                .update() > 0;
    }

    // ------------------------------------------------------------------ accounts

    @Transactional
    public boolean user(UserSnapshot u) {
        return upsertUser(u.getUserId(), u.getEmail(), u.getFirstName(), u.getLastName(), String.join(",", u.getRoles()),
                u.getStatus(), u.getEmailVerified(), u.getRegisteredAt());
    }

    @Transactional
    public boolean userRegistered(UserRegistered u) {
        return upsertUser(u.getUserId(), u.getEmail(), u.getFirstName(), u.getLastName(), String.join(",", u.getRoles()),
                u.getStatus(), false, u.getRegisteredAt());
    }

    @Transactional
    public boolean emailVerified(EmailVerified v) {
        return jdbc.sql("UPDATE user_facts SET email_verified = TRUE, status = IF(status = 'PENDING_VERIFICATION', "
                        + "'ACTIVE', status), updated_at = :now WHERE user_id = UUID_TO_BIN(:id)")
                .param("id", v.getUserId()).param("now", utc(clock.instant())).update() > 0;
    }

    @Transactional
    public boolean statusChanged(UserStatusChanged s) {
        return jdbc.sql("UPDATE user_facts SET status = :status, updated_at = :now WHERE user_id = UUID_TO_BIN(:id)")
                .param("id", s.getUserId()).param("status", s.getStatus()).param("now", utc(clock.instant()))
                .update() > 0;
    }

    @Transactional
    public boolean rolesChanged(UserRolesChanged r) {
        return jdbc.sql("UPDATE user_facts SET roles = :roles, updated_at = :now WHERE user_id = UUID_TO_BIN(:id)")
                .param("id", r.getUserId()).param("roles", String.join(",", r.getRoles()))
                .param("now", utc(clock.instant())).update() > 0;
    }

    @Transactional
    public boolean profileUpdated(UserProfileUpdated p) {
        return jdbc.sql("UPDATE user_facts SET email = :email, first_name = :first, last_name = :last, "
                        + "updated_at = :now WHERE user_id = UUID_TO_BIN(:id)")
                .param("id", p.getUserId()).param("email", p.getEmail()).param("first", p.getFirstName())
                .param("last", p.getLastName()).param("now", utc(clock.instant())).update() > 0;
    }

    private boolean upsertUser(String id, String email, String first, String last, String roles, String status,
            boolean verified, Instant registeredAt) {
        return jdbc.sql("""
                        INSERT INTO user_facts (user_id, email, first_name, last_name, roles, status, email_verified,
                            registered_at, updated_at)
                        VALUES (UUID_TO_BIN(:id), :email, :first, :last, :roles, :status, :verified, :registered, :now)
                        ON DUPLICATE KEY UPDATE email = VALUES(email), first_name = VALUES(first_name),
                            last_name = VALUES(last_name), roles = VALUES(roles), status = VALUES(status),
                            email_verified = email_verified OR VALUES(email_verified),
                            registered_at = LEAST(registered_at, VALUES(registered_at)), updated_at = VALUES(updated_at)""")
                .param("id", id).param("email", email).param("first", first).param("last", last)
                .param("roles", roles).param("status", status).param("verified", verified)
                .param("registered", utc(registeredAt)).param("now", utc(clock.instant()))
                .update() > 0;
    }

    // ------------------------------------------------------------------ helpers

    /** DATETIME columns hold UTC; a plain LocalDateTime keeps the driver from shifting it. */
    static LocalDateTime utc(Instant instant) {
        return instant == null ? null : LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static String limit(String text, int max) {
        return text == null || text.length() <= max ? text : text.substring(0, max);
    }
}
