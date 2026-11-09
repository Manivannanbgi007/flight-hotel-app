package com.flighthotel.hotel.staff;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.flighthotel.hotel.support.Uuids;

/**
 * Local copy of user accounts from identity-service ({@code identity.events}). Used to assign hotel managers by
 * email and to show their names, without calling identity-service.
 */
@Component
public class KnownUserStore {

    private final JdbcClient jdbc;

    public KnownUserStore(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void upsert(KnownUser user, Instant now) {
        jdbc.sql("""
                        INSERT INTO known_users (user_id, email, first_name, last_name, roles, status, updated_at)
                        VALUES (:id, :email, :firstName, :lastName, :roles, :status, :now)
                        ON DUPLICATE KEY UPDATE email = VALUES(email), first_name = VALUES(first_name),
                          last_name = VALUES(last_name), roles = VALUES(roles), status = VALUES(status),
                          updated_at = VALUES(updated_at)""")
                .param("id", Uuids.param(user.userId()))
                .param("email", user.email().toLowerCase(Locale.ROOT))
                .param("firstName", user.firstName())
                .param("lastName", user.lastName())
                .param("roles", String.join(",", user.roles()))
                .param("status", user.status())
                .param("now", Timestamp.from(now))
                .update();
    }

    public void updateProfile(UUID userId, String email, String firstName, String lastName, Instant now) {
        jdbc.sql("""
                        UPDATE known_users SET email = :email, first_name = :firstName, last_name = :lastName,
                          updated_at = :now WHERE user_id = :id""")
                .param("id", Uuids.param(userId))
                .param("email", email.toLowerCase(Locale.ROOT))
                .param("firstName", firstName)
                .param("lastName", lastName)
                .param("now", Timestamp.from(now))
                .update();
    }

    public void updateRoles(UUID userId, Set<String> roles, Instant now) {
        jdbc.sql("UPDATE known_users SET roles = :roles, updated_at = :now WHERE user_id = :id")
                .param("id", Uuids.param(userId))
                .param("roles", String.join(",", new TreeSet<>(roles)))
                .param("now", Timestamp.from(now))
                .update();
    }

    public void updateStatus(UUID userId, String status, Instant now) {
        jdbc.sql("UPDATE known_users SET status = :status, updated_at = :now WHERE user_id = :id")
                .param("id", Uuids.param(userId))
                .param("status", status)
                .param("now", Timestamp.from(now))
                .update();
    }

    public Optional<KnownUser> findByEmail(String email) {
        return jdbc.sql("SELECT * FROM known_users WHERE email = :email")
                .param("email", email.trim().toLowerCase(Locale.ROOT))
                .query((rs, i) -> map(rs))
                .optional();
    }

    public Optional<KnownUser> findById(UUID userId) {
        return jdbc.sql("SELECT * FROM known_users WHERE user_id = :id")
                .param("id", Uuids.param(userId))
                .query((rs, i) -> map(rs))
                .optional();
    }

    private static KnownUser map(java.sql.ResultSet rs) throws java.sql.SQLException {
        String roles = rs.getString("roles");
        return new KnownUser(Uuids.fromBytes(rs.getBytes("user_id")), rs.getString("email"), rs.getString("first_name"),
                rs.getString("last_name"),
                roles.isBlank() ? Set.of() : new TreeSet<>(Arrays.asList(roles.split(","))), rs.getString("status"));
    }

    public record KnownUser(UUID userId, String email, String firstName, String lastName, Set<String> roles,
                            String status) {


        public boolean hasRole(String role) {
            return roles.contains(role);
        }
    }
}
