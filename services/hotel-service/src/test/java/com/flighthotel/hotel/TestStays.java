package com.flighthotel.hotel;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.events.audit.AuditEventRecorded;
import com.flighthotel.hotel.entity.DataSource;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelReservation;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.entity.PropertyType;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.ReservationGuest;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.inventory.InventoryService;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.HotelReservationRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.support.Uuids;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/**
 * Test data for the Phase 9 tests: own hotels (so the demo catalogue stays untouched), rooms with inventory for any
 * dates (also past ones), and reservations in any state written straight to the database, with the inventory
 * counters they would have caused. Also decodes hotel-service's outbox like a Kafka consumer.
 */
final class TestStays {

    private static final KafkaAvroDeserializer AVRO = new KafkaAvroDeserializer();

    static {
        AVRO.configure(Map.of("schema.registry.url", "mock://hotel-it", "specific.avro.reader", true), false);
    }

    private final TransactionTemplate transactions;
    private final HotelRepository hotels;
    private final RoomTypeRepository roomTypes;
    private final RatePlanRepository ratePlans;
    private final HotelReservationRepository reservations;
    private final InventoryService inventory;
    private final JdbcClient jdbc;

    TestStays(TransactionTemplate transactions, HotelRepository hotels, RoomTypeRepository roomTypes,
            RatePlanRepository ratePlans, HotelReservationRepository reservations, InventoryService inventory,
            JdbcClient jdbc) {
        this.transactions = transactions;
        this.hotels = hotels;
        this.roomTypes = roomTypes;
        this.ratePlans = ratePlans;
        this.reservations = reservations;
        this.inventory = inventory;
        this.jdbc = jdbc;
    }

    record Room(UUID hotelId, UUID roomTypeId, UUID ratePlanId) {
    }

    /** A published hotel of our own (India time, check-in 14:00, check-out 11:00), optionally with seed ratings. */
    Hotel hotel(String name, String city, HotelStatus status, BigDecimal seedRating, int seedReviews) {
        return transactions.execute(tx -> {
            String unique = name + " " + UUID.randomUUID().toString().substring(0, 8);
            Hotel hotel = new Hotel(unique, unique.toLowerCase(Locale.ROOT).replace(' ', '-'), PropertyType.HOTEL,
                    "1 Test Road", city, "IN", DataSource.INTERNAL);
            if (seedRating != null) {
                hotel.startWithRating(seedRating, seedReviews);
            }
            hotel.changeStatus(status);
            return hotels.saveAndFlush(hotel);
        });
    }

    Hotel hotel(String name, String city) {
        return hotel(name, city, HotelStatus.ACTIVE, null, 0);
    }

    /** A room type with a refundable plan and inventory for the nights [from, to). */
    Room room(UUID hotelId, int totalRooms, String price, LocalDate from, LocalDate to) {
        return transactions.execute(tx -> {
            RoomType room = new RoomType(hotelId);
            room.setName("Test room " + UUID.randomUUID().toString().substring(0, 8));
            room.setMaxAdults(2);
            room.setMaxChildren(1);
            room.setBedConfiguration("1 Queen bed");
            room.setTotalRooms(totalRooms);
            roomTypes.saveAndFlush(room);
            inventory.createNights(room.getId(), totalRooms, from, to);
            RatePlan plan = new RatePlan(room.getId());
            plan.setName("Flexible");
            plan.setBasePricePerNight(new BigDecimal(price));
            plan.setCancellation(true, 48, BigDecimal.valueOf(50));
            ratePlans.saveAndFlush(plan);
            return new Room(hotelId, room.getId(), plan.getId());
        });
    }

    HotelReservation stay(Room room, UUID userId, LocalDate checkIn, LocalDate checkOut, ReservationStatus status) {
        return stay(room, userId, checkIn, checkOut, 1, "3000.00", status, "Asha", "Rao");
    }

    /**
     * A reservation as the saga and the front desk would have left it, plus the inventory counters it holds (held
     * rooms for HELD, booked rooms for CONFIRMED and later; nothing for cancelled or expired ones).
     */
    HotelReservation stay(Room room, UUID userId, LocalDate checkIn, LocalDate checkOut, int rooms, String subtotal,
            ReservationStatus status, String firstName, String lastName) {
        HotelReservation saved = transactions.execute(tx -> {
            UUID bookingId = UuidV7.generate();
            List<ReservationGuest> guests = new ArrayList<>();
            guests.add(new ReservationGuest(1, firstName, lastName));
            for (int n = 2; n <= rooms; n++) {
                guests.add(new ReservationGuest(n, "Guest", "Number" + n));
            }
            BigDecimal net = new BigDecimal(subtotal);
            BigDecimal taxes = net.multiply(BigDecimal.valueOf(5)).divide(BigDecimal.valueOf(100), 2,
                    RoundingMode.HALF_UP);
            HotelReservation reservation = HotelReservation.hold(
                    new HotelReservation.Stay(bookingId, "HT-" + random(8), userId, room.hotelId(),
                            room.roomTypeId(), room.ratePlanId(), UUID.randomUUID(), checkIn, checkOut),
                    new HotelReservation.Party(rooms, rooms * 2, 0, guests),
                    new HotelReservation.Price(net, taxes, net.add(taxes), "INR"),
                    new HotelReservation.Contact("guest-" + random(6).toLowerCase(Locale.ROOT) + "@example.com",
                            "+919800000000", "Late arrival, around 23:00"),
                    Instant.now().plusSeconds(1200));
            Instant now = Instant.now();
            switch (status) {
                case HELD -> {
                }
                case EXPIRED -> reservation.expire(now);
                case RELEASED -> reservation.release("BOOKING_FAILED", now);
                default -> {
                    reservation.confirm("T" + random(9), now);
                    switch (status) {
                        case CHECKED_IN -> reservation.checkIn(now);
                        case CHECKED_OUT -> {
                            reservation.checkIn(now);
                            reservation.checkOut(now);
                        }
                        case NO_SHOW -> reservation.markNoShow(now);
                        case CANCELLED -> reservation.cancel(UuidV7.generate(), "HX" + random(8), now);
                        default -> {
                        }
                    }
                }
            }
            return reservations.saveAndFlush(reservation);
        });
        String counter = switch (status) {
            case HELD -> "held_rooms";
            case CONFIRMED, CHECKED_IN, CHECKED_OUT, NO_SHOW -> "booked_rooms";
            default -> null;
        };
        if (counter != null) {
            jdbc.sql("UPDATE room_inventory SET " + counter + " = " + counter + " + :rooms WHERE room_type_id = :room"
                            + " AND stay_date >= :checkIn AND stay_date < :checkOut")
                    .param("rooms", rooms)
                    .param("room", Uuids.param(room.roomTypeId()))
                    .param("checkIn", checkIn)
                    .param("checkOut", checkOut)
                    .update();
        }
        return saved;
    }

    /** Booked rooms per night of [from, to). */
    List<Integer> bookedRooms(Room room, LocalDate from, LocalDate to) {
        return jdbc.sql("""
                        SELECT booked_rooms FROM room_inventory WHERE room_type_id = :room
                        AND stay_date >= :from AND stay_date < :to ORDER BY stay_date""")
                .param("room", Uuids.param(room.roomTypeId()))
                .param("from", from)
                .param("to", to)
                .query(Integer.class)
                .list();
    }

    /** hotel-service's events with this key (booking id or hotel id), decoded like a Kafka consumer would. */
    List<Object> hotelEvents(UUID key) {
        return jdbc.sql("""
                        SELECT payload FROM outbox_events WHERE aggregate_type = 'hotel' AND aggregate_id = :id
                        ORDER BY created_at, id""")
                .param("id", key.toString())
                .query((rs, i) -> AVRO.deserialize("hotel.events", rs.getBytes("payload")))
                .list();
    }

    List<AuditEventRecorded> auditEvents(UUID entityId) {
        return jdbc.sql("""
                        SELECT payload FROM outbox_events WHERE aggregate_type = 'audit' AND aggregate_id = :id
                        ORDER BY created_at, id""")
                .param("id", entityId.toString())
                .query((rs, i) -> (AuditEventRecorded) AVRO.deserialize("audit.events", rs.getBytes("payload")))
                .list();
    }

    private static String random(int length) {
        return UUID.randomUUID().toString().replace("-", "").substring(0, length).toUpperCase(Locale.ROOT);
    }
}
