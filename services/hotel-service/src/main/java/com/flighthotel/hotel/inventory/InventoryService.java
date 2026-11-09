package com.flighthotel.hotel.inventory;

import static java.time.temporal.ChronoUnit.DAYS;

import java.sql.Date;
import java.sql.Types;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.SqlParameterValue;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.id.UuidV7;
import com.flighthotel.hotel.support.Uuids;

/**
 * Per-night room inventory ({@code room_inventory}). Each night has total, booked and held rooms; free = total -
 * booked - held (0 when stop-sell is on).
 * <p>
 * <b>No overbooking:</b> a hold locks all nights of the stay ({@code SELECT ... FOR UPDATE}, in date order), checks
 * that every night has enough free rooms, and only then runs ONE conditional UPDATE over them. Two customers racing
 * for the last room cannot both succeed: the second one waits for the first one's lock and then sees its result. A
 * failed hold changes nothing. The table's CHECK constraint is the last line of defence.
 */
@Service
public class InventoryService {

    /** How far ahead rooms are for sale (nights are created this far ahead and extended daily). */
    public static final int HORIZON_DAYS = 365;
    private static final Logger log = LoggerFactory.getLogger(InventoryService.class);
    private static final String FREE = "CASE WHEN stop_sell THEN 0 ELSE total_rooms - booked_rooms - held_rooms END";

    private final JdbcClient jdbc;
    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    public InventoryService(JdbcClient jdbc, JdbcTemplate jdbcTemplate, Clock clock) {
        this.jdbc = jdbc;
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    /** Today in India (all demo and launch hotels; a per-hotel zone is used for cancellation deadlines). */
    public LocalDate today() {
        return LocalDate.now(clock.withZone(ZoneId.of("Asia/Kolkata")));
    }

    public LocalDate lastSellableNight() {
        return today().plusDays(HORIZON_DAYS - 1);
    }

    /** Creates the missing nights in [from, to) with {@code totalRooms} rooms. Existing nights are left alone. */
    @Transactional
    public int createNights(UUID roomTypeId, int totalRooms, LocalDate from, LocalDate to) {
        byte[] roomType = Uuids.toBytes(roomTypeId);
        List<Object[]> rows = new ArrayList<>();
        for (LocalDate night = from; night.isBefore(to); night = night.plusDays(1)) {
            rows.add(new Object[] {Uuids.toBytes(UuidV7.generate()), roomType, Date.valueOf(night), totalRooms});
        }
        if (rows.isEmpty()) {
            return 0;
        }
        int[][] results = jdbcTemplate.batchUpdate("""
                        INSERT IGNORE INTO room_inventory (id, room_type_id, stay_date, total_rooms)
                        VALUES (?, ?, ?, ?)""", rows, 500,
                (ps, row) -> {
                    ps.setBytes(1, (byte[]) row[0]);
                    ps.setBytes(2, (byte[]) row[1]);
                    ps.setDate(3, (Date) row[2]);
                    ps.setInt(4, (Integer) row[3]);
                });
        int created = 0;
        for (int[] batch : results) {
            for (int count : batch) {
                created += Math.max(count, 0);
            }
        }
        return created;
    }

    /** Creates the sellable nights for a new room type (today until the horizon). */
    @Transactional
    public void initialize(UUID roomTypeId, int totalRooms) {
        createNights(roomTypeId, totalRooms, today(), today().plusDays(HORIZON_DAYS));
    }

    /**
     * Free rooms for the WHOLE stay [checkIn, checkOut) per room type: the minimum over the nights, 0 if any night
     * is missing (beyond the horizon) or stopped.
     */
    public Map<UUID, Integer> freeRooms(Collection<UUID> roomTypeIds, LocalDate checkIn, LocalDate checkOut) {
        Map<UUID, Integer> free = new HashMap<>();
        if (roomTypeIds.isEmpty()) {
            return free;
        }
        long nights = DAYS.between(checkIn, checkOut);
        jdbc.sql("SELECT room_type_id, COUNT(*) AS nights, MIN(" + FREE + ") AS free FROM room_inventory"
                        + " WHERE room_type_id IN (:ids) AND stay_date >= :checkIn AND stay_date < :checkOut"
                        + " GROUP BY room_type_id")
                .param("ids", Uuids.params(roomTypeIds))
                .param("checkIn", Date.valueOf(checkIn))
                .param("checkOut", Date.valueOf(checkOut))
                .query((rs, i) -> {
                    UUID id = Uuids.fromBytes(rs.getBytes("room_type_id"));
                    free.put(id, rs.getLong("nights") == nights ? Math.max(rs.getInt("free"), 0) : 0);
                    return null;
                })
                .list();
        roomTypeIds.forEach(id -> free.putIfAbsent(id, 0));
        return free;
    }

    /** Takes {@code rooms} rooms out of sale for every night of the stay, or throws {@code 409 ROOMS_NOT_AVAILABLE}. */
    @Transactional
    public void hold(UUID roomTypeId, LocalDate checkIn, LocalDate checkOut, int rooms) {
        if (!tryHold(roomTypeId, checkIn, checkOut, rooms)) {
            throw new ConflictException("ROOMS_NOT_AVAILABLE", "These rooms are no longer available for your dates.");
        }
    }

    /**
     * Takes {@code rooms} rooms out of sale for every night of the stay and returns {@code true}, or changes NOTHING
     * and returns {@code false}.
     * <p>
     * The nights are first locked ({@code SELECT ... FOR UPDATE}, always in date order, so two overlapping holds
     * never deadlock) and checked; only then are they updated. Because a failed hold changes no row, the caller's
     * transaction can go on and record the failure (saga: {@code HotelInventoryHoldFailed} + inbox marker), which an
     * exception thrown half-way through an update would not allow.
     */
    @Transactional
    public boolean tryHold(UUID roomTypeId, LocalDate checkIn, LocalDate checkOut, int rooms) {
        long nights = DAYS.between(checkIn, checkOut);
        List<Integer> free = jdbc.sql("SELECT " + FREE + " AS free FROM room_inventory"
                        + " WHERE room_type_id = :roomType AND stay_date >= :checkIn AND stay_date < :checkOut"
                        + " ORDER BY stay_date FOR UPDATE")
                .param("roomType", Uuids.param(roomTypeId))
                .param("checkIn", Date.valueOf(checkIn))
                .param("checkOut", Date.valueOf(checkOut))
                .query((rs, i) -> rs.getInt("free"))
                .list();
        if (free.size() != nights || free.stream().anyMatch(f -> f < rooms)) {
            return false;
        }
        int changed = jdbc.sql("UPDATE room_inventory SET held_rooms = held_rooms + :rooms, version = version + 1"
                        + " WHERE room_type_id = :roomType AND stay_date >= :checkIn AND stay_date < :checkOut"
                        + " AND stop_sell = FALSE AND total_rooms - booked_rooms - held_rooms >= :rooms")
                .param("rooms", rooms)
                .param("roomType", Uuids.param(roomTypeId))
                .param("checkIn", Date.valueOf(checkIn))
                .param("checkOut", Date.valueOf(checkOut))
                .update();
        if (changed != nights) {
            // Cannot happen while the rows are locked; the CHECK constraint is the last line of defence anyway.
            throw new IllegalStateException("Hold changed " + changed + " of " + nights + " nights for roomType="
                    + roomTypeId);
        }
        return true;
    }

    /** Gives held rooms back (hold expired or booking failed). */
    @Transactional
    public void release(UUID roomTypeId, LocalDate checkIn, LocalDate checkOut, int rooms) {
        moveHeld(roomTypeId, checkIn, checkOut, rooms, "held_rooms = held_rooms - :rooms");
    }

    /** Held rooms become booked (payment received). */
    @Transactional
    public void confirm(UUID roomTypeId, LocalDate checkIn, LocalDate checkOut, int rooms) {
        moveHeld(roomTypeId, checkIn, checkOut, rooms, "held_rooms = held_rooms - :rooms, booked_rooms = booked_rooms + :rooms");
    }

    /** Booked rooms go back on sale (a confirmed reservation was cancelled before check-in). */
    @Transactional
    public void cancelBooked(UUID roomTypeId, LocalDate checkIn, LocalDate checkOut, int rooms) {
        int changed = jdbc.sql("UPDATE room_inventory SET booked_rooms = booked_rooms - :rooms, version = version + 1"
                        + " WHERE room_type_id = :roomType AND stay_date >= :checkIn AND stay_date < :checkOut"
                        + " AND booked_rooms >= :rooms")
                .param("rooms", rooms)
                .param("roomType", Uuids.param(roomTypeId))
                .param("checkIn", Date.valueOf(checkIn))
                .param("checkOut", Date.valueOf(checkOut))
                .update();
        if (changed != DAYS.between(checkIn, checkOut)) {
            throw new IllegalStateException("Booked rooms missing for roomType=" + roomTypeId + " " + checkIn + ".."
                    + checkOut);
        }
    }

    private void moveHeld(UUID roomTypeId, LocalDate checkIn, LocalDate checkOut, int rooms, String assignment) {
        int changed = jdbc.sql("UPDATE room_inventory SET " + assignment + ", version = version + 1"
                        + " WHERE room_type_id = :roomType AND stay_date >= :checkIn AND stay_date < :checkOut"
                        + " AND held_rooms >= :rooms")
                .param("rooms", rooms)
                .param("roomType", Uuids.param(roomTypeId))
                .param("checkIn", Date.valueOf(checkIn))
                .param("checkOut", Date.valueOf(checkOut))
                .update();
        if (changed != DAYS.between(checkIn, checkOut)) {
            throw new IllegalStateException("Held rooms missing for roomType=" + roomTypeId + " " + checkIn + ".." + checkOut);
        }
    }

    /** The nights in [from, to] for the manager's calendar. */
    public List<InventoryNight> calendar(Collection<UUID> roomTypeIds, LocalDate from, LocalDate to) {
        if (roomTypeIds.isEmpty()) {
            return List.of();
        }
        return jdbc.sql("SELECT room_type_id, stay_date, total_rooms, booked_rooms, held_rooms, stop_sell"
                        + " FROM room_inventory WHERE room_type_id IN (:ids) AND stay_date BETWEEN :from AND :to"
                        + " ORDER BY stay_date, room_type_id")
                .param("ids", Uuids.params(roomTypeIds))
                .param("from", Date.valueOf(from))
                .param("to", Date.valueOf(to))
                .query((rs, i) -> new InventoryNight(Uuids.fromBytes(rs.getBytes("room_type_id")),
                        rs.getDate("stay_date").toLocalDate(), rs.getInt("total_rooms"), rs.getInt("booked_rooms"),
                        rs.getInt("held_rooms"), rs.getBoolean("stop_sell")))
                .list();
    }

    /**
     * Manager change for the nights [from, to]: rooms for sale and/or stop-sell. The room count can never go below
     * what is already booked or held on a night; such nights are reported and nothing is changed.
     */
    @Transactional
    public int updateNights(UUID roomTypeId, LocalDate from, LocalDate to, Integer totalRooms, Boolean stopSell) {
        LocalDate end = to.plusDays(1);
        if (totalRooms != null) {
            List<LocalDate> conflicts = jdbc.sql("SELECT stay_date FROM room_inventory WHERE room_type_id = :roomType"
                            + " AND stay_date >= :from AND stay_date < :to AND booked_rooms + held_rooms > :total"
                            + " ORDER BY stay_date")
                    .param("roomType", Uuids.param(roomTypeId))
                    .param("from", Date.valueOf(from))
                    .param("to", Date.valueOf(end))
                    .param("total", totalRooms)
                    .query((rs, i) -> rs.getDate("stay_date").toLocalDate())
                    .list();
            if (!conflicts.isEmpty()) {
                throw new InventoryConflictException(conflicts);
            }
        }
        List<String> assignments = new ArrayList<>();
        if (totalRooms != null) {
            assignments.add("total_rooms = :total");
        }
        if (stopSell != null) {
            assignments.add("stop_sell = :stopSell");
        }
        if (assignments.isEmpty()) {
            return 0;
        }
        JdbcClient.StatementSpec statement = jdbc.sql("UPDATE room_inventory SET " + String.join(", ", assignments)
                        + ", version = version + 1 WHERE room_type_id = :roomType AND stay_date >= :from AND stay_date < :to")
                .param("roomType", Uuids.param(roomTypeId))
                .param("from", Date.valueOf(from))
                .param("to", Date.valueOf(end));
        if (totalRooms != null) {
            statement = statement.param("total", totalRooms);
        }
        if (stopSell != null) {
            statement = statement.param("stopSell", new SqlParameterValue(Types.BOOLEAN, stopSell));
        }
        return statement.update();
    }

    /** Extends every room type on sale to the full horizon (runs daily and on startup). */
    @Transactional
    public int extendHorizon(Map<UUID, Integer> totalRoomsByRoomType) {
        LocalDate from = today();
        LocalDate to = from.plusDays(HORIZON_DAYS);
        int created = 0;
        for (Map.Entry<UUID, Integer> entry : totalRoomsByRoomType.entrySet()) {
            created += createNights(entry.getKey(), entry.getValue(), from, to);
        }
        if (created > 0) {
            log.info("Inventory horizon extended: nightsCreated={} roomTypes={}", created, totalRoomsByRoomType.size());
        }
        return created;
    }

    public record InventoryNight(UUID roomTypeId, LocalDate date, int totalRooms, int bookedRooms, int heldRooms,
                                 boolean stopSell) {

        public int freeRooms() {
            return stopSell ? 0 : Math.max(totalRooms - bookedRooms - heldRooms, 0);
        }
    }
}
