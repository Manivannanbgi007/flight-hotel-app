package com.flighthotel.hotel.staff;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.flighthotel.hotel.support.Uuids;

/** Which users manage which hotels ({@code hotel_staff}). */
@Component
public class HotelStaffStore {

    private final JdbcClient jdbc;

    public HotelStaffStore(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** @return true if the user was not assigned yet */
    public boolean assign(UUID hotelId, UUID userId, String assignedBy, Instant now) {
        return jdbc.sql("""
                        INSERT IGNORE INTO hotel_staff (hotel_id, user_id, staff_role, assigned_at, assigned_by)
                        VALUES (:hotel, :user, 'MANAGER', :now, :by)""")
                .param("hotel", Uuids.param(hotelId))
                .param("user", Uuids.param(userId))
                .param("now", Timestamp.from(now))
                .param("by", assignedBy)
                .update() == 1;
    }

    public boolean unassign(UUID hotelId, UUID userId) {
        return jdbc.sql("DELETE FROM hotel_staff WHERE hotel_id = :hotel AND user_id = :user")
                .param("hotel", Uuids.param(hotelId))
                .param("user", Uuids.param(userId))
                .update() == 1;
    }

    public boolean isAssigned(UUID hotelId, UUID userId) {
        return jdbc.sql("SELECT COUNT(*) FROM hotel_staff WHERE hotel_id = :hotel AND user_id = :user")
                .param("hotel", Uuids.param(hotelId))
                .param("user", Uuids.param(userId))
                .query(Long.class).single() > 0;
    }

    public Set<UUID> hotelIdsOf(UUID userId) {
        return jdbc.sql("SELECT hotel_id FROM hotel_staff WHERE user_id = :user")
                .param("user", Uuids.param(userId))
                .query((rs, i) -> Uuids.fromBytes(rs.getBytes("hotel_id")))
                .stream().collect(Collectors.toSet());
    }

    public long countFor(UUID hotelId) {
        return jdbc.sql("SELECT COUNT(*) FROM hotel_staff WHERE hotel_id = :hotel")
                .param("hotel", Uuids.param(hotelId))
                .query(Long.class).single();
    }

    /** Managers of a hotel with their names (from the local copy of identity's users). */
    public List<StaffMember> managersOf(UUID hotelId) {
        return jdbc.sql("""
                        SELECT s.user_id, s.assigned_at, u.email, u.first_name, u.last_name
                        FROM hotel_staff s LEFT JOIN known_users u ON u.user_id = s.user_id
                        WHERE s.hotel_id = :hotel ORDER BY s.assigned_at""")
                .param("hotel", Uuids.param(hotelId))
                .query((rs, i) -> new StaffMember(Uuids.fromBytes(rs.getBytes("user_id")), rs.getString("email"),
                        rs.getString("first_name"), rs.getString("last_name"),
                        rs.getTimestamp("assigned_at").toInstant()))
                .list();
    }

    public record StaffMember(UUID userId, String email, String firstName, String lastName, Instant assignedAt) {
    }
}
