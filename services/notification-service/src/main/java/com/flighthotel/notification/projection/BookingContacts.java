package com.flighthotel.notification.projection;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Who a booking belongs to and how to address the customer, from booking events (projection, rebuilt by replaying
 * {@code booking.events}). Payment and refund events carry no contact details, so their e-mails and receipts read them
 * here; support tickets use it to check that a booking is the customer's own.
 */
@Component
public class BookingContacts {

    private final JdbcClient jdbc;

    public BookingContacts(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public record BookingContact(UUID bookingId, UUID userId, String bookingReference, String bookingType,
            String description, String contactEmail, String customerName, boolean demo) {

        /** For greetings: the lead guest / passenger once known, the e-mail before. */
        public String greetingName() {
            return customerName != null ? customerName : contactEmail;
        }
    }

    /** First sight of a booking (rooms or seats held): the description the customer sees on the payment page. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void held(UUID bookingId, UUID userId, String reference, String type, String description, String email,
            Instant now) {
        jdbc.sql("""
                        INSERT INTO booking_contacts (booking_id, user_id, booking_reference, booking_type, description,
                            contact_email, updated_at)
                        VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:user), :reference, :type, :description, :email, :now)
                        ON DUPLICATE KEY UPDATE description = VALUES(description), updated_at = VALUES(updated_at)""")
                .param("id", bookingId.toString()).param("user", userId.toString()).param("reference", reference)
                .param("type", type).param("description", limit(description, 255)).param("email", email)
                .param("now", utc(now)).update();
    }

    /** Confirmed: now the lead guest or first passenger is known (also creates the row if events came out of order). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void confirmed(UUID bookingId, UUID userId, String reference, String type, String email, String customerName,
            boolean demo, Instant now) {
        jdbc.sql("""
                        INSERT INTO booking_contacts (booking_id, user_id, booking_reference, booking_type, contact_email,
                            customer_name, demo, updated_at)
                        VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:user), :reference, :type, :email, :name, :demo, :now)
                        ON DUPLICATE KEY UPDATE customer_name = VALUES(customer_name), demo = VALUES(demo),
                            updated_at = VALUES(updated_at)""")
                .param("id", bookingId.toString()).param("user", userId.toString()).param("reference", reference)
                .param("type", type).param("email", email).param("name", limit(customerName, 130))
                .param("demo", demo).param("now", utc(now)).update();
    }

    public Optional<BookingContact> find(UUID bookingId) {
        return jdbc.sql("""
                        SELECT BIN_TO_UUID(booking_id) AS booking_id, BIN_TO_UUID(user_id) AS user_id, booking_reference,
                            booking_type, description, contact_email, customer_name, demo
                        FROM booking_contacts WHERE booking_id = UUID_TO_BIN(:id)""")
                .param("id", bookingId.toString())
                .query(BookingContacts::map)
                .optional();
    }

    private static BookingContact map(ResultSet rs, int row) throws SQLException {
        return new BookingContact(UUID.fromString(rs.getString("booking_id")), UUID.fromString(rs.getString("user_id")),
                rs.getString("booking_reference"), rs.getString("booking_type"), rs.getString("description"),
                rs.getString("contact_email"), rs.getString("customer_name"), rs.getBoolean("demo"));
    }

    static LocalDateTime utc(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static String limit(String text, int max) {
        return text == null || text.length() <= max ? text : text.substring(0, max);
    }
}
