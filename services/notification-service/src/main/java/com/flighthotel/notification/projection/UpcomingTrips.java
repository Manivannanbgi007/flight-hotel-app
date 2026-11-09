package com.flighthotel.notification.projection;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * Confirmed trips and when they start (projection of {@code BookingConfirmed}, {@code BookingCancelled},
 * {@code BookingCompleted}), for the travel reminder 24 hours before check-in or departure.
 */
@Component
public class UpcomingTrips {

    public static final String ACTIVE = "ACTIVE";

    private final JdbcClient jdbc;
    private final JsonMapper json;

    public UpcomingTrips(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public record Row(String label, String value) {
    }

    public record Trip(UUID bookingId, UUID userId, String bookingReference, String bookingType, String title,
            String contactEmail, String customerName, Instant startsAt, List<Row> details) {
    }

    /** A confirmed trip; a trip confirmed less than {@code leadTime} before it starts needs no reminder. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void confirmed(Trip trip, Instant confirmedAt, boolean reminderNeeded) {
        jdbc.sql("""
                        INSERT INTO upcoming_trips (booking_id, user_id, booking_reference, booking_type, title,
                            contact_email, customer_name, starts_at, details_json, status, reminder_sent_at, confirmed_at)
                        VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:user), :reference, :type, :title, :email, :name, :startsAt,
                            :details, 'ACTIVE', :sent, :confirmedAt)
                        ON DUPLICATE KEY UPDATE booking_reference = VALUES(booking_reference)""")
                .param("id", trip.bookingId().toString()).param("user", trip.userId().toString())
                .param("reference", trip.bookingReference()).param("type", trip.bookingType())
                .param("title", limit(trip.title(), 200)).param("email", trip.contactEmail())
                .param("name", limit(trip.customerName(), 130)).param("startsAt", utc(trip.startsAt()))
                .param("details", json.writeValueAsString(trip.details()))
                // A last-minute booking: the confirmation e-mail already says everything a reminder would.
                .param("sent", reminderNeeded ? null : utc(confirmedAt))
                .param("confirmedAt", utc(confirmedAt))
                .update();
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void ended(UUID bookingId, String status) {
        jdbc.sql("UPDATE upcoming_trips SET status = :status WHERE booking_id = UUID_TO_BIN(:id)")
                .param("status", status).param("id", bookingId.toString()).update();
    }

    /** Active trips starting before {@code until} whose reminder has not gone out. */
    public List<UUID> due(Instant now, Instant until, int limit) {
        return jdbc.sql("""
                        SELECT BIN_TO_UUID(booking_id) FROM upcoming_trips
                        WHERE status = 'ACTIVE' AND reminder_sent_at IS NULL AND starts_at > :now AND starts_at <= :until
                        ORDER BY starts_at LIMIT :limit""")
                .param("now", utc(now)).param("until", utc(until)).param("limit", limit)
                .query(String.class).list().stream().map(UUID::fromString).toList();
    }

    /** Locks the trip (one reminder even with several instances) if it still needs its reminder. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<Trip> lockDue(UUID bookingId) {
        return jdbc.sql("""
                        SELECT BIN_TO_UUID(booking_id) AS booking_id, BIN_TO_UUID(user_id) AS user_id, booking_reference,
                            booking_type, title, contact_email, customer_name, starts_at, details_json
                        FROM upcoming_trips WHERE booking_id = UUID_TO_BIN(:id) AND status = 'ACTIVE'
                            AND reminder_sent_at IS NULL FOR UPDATE""")
                .param("id", bookingId.toString())
                .query((rs, i) -> new Trip(UUID.fromString(rs.getString("booking_id")),
                        UUID.fromString(rs.getString("user_id")), rs.getString("booking_reference"),
                        rs.getString("booking_type"), rs.getString("title"), rs.getString("contact_email"),
                        rs.getString("customer_name"),
                        rs.getObject("starts_at", LocalDateTime.class).toInstant(ZoneOffset.UTC),
                        json.readValue(rs.getString("details_json"), new TypeReference<List<Row>>() { })))
                .optional();
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void reminderSent(UUID bookingId, Instant now) {
        jdbc.sql("UPDATE upcoming_trips SET reminder_sent_at = :now WHERE booking_id = UUID_TO_BIN(:id)")
                .param("now", utc(now)).param("id", bookingId.toString()).update();
    }

    private static LocalDateTime utc(Instant instant) {
        return instant == null ? null : LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static String limit(String text, int max) {
        return text == null || text.length() <= max ? text : text.substring(0, max);
    }
}
