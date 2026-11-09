package com.flighthotel.hotel;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;

import com.flighthotel.common.dev.DevIds;
import com.flighthotel.common.dev.DevScenario;
import com.flighthotel.events.hotel.HotelReviewSnapshot;
import com.flighthotel.hotel.devseed.DevHotelSeeder;
import com.flighthotel.hotel.search.HotelIndexer;

/**
 * The development hotels: catalogue, inventory, managers, reservations in every state and reviews, with the ids the
 * other services expect; never twice; never when the switch is off or the prod profile is active. The seeder is
 * created by hand (the shared test context runs with the switch off) and its rows are removed after each test, so
 * the other tests keep seeing only the labelled demo catalogue.
 */
class DevHotelSeederIntegrationTest extends HotelIntegrationTest {

    @Autowired
    ConfigurableApplicationContext context;

    @Autowired
    HotelIndexer indexer;

    @BeforeEach
    @AfterEach
    void removeDevRows() {
        String hotels = "(SELECT id FROM hotels WHERE data_source = 'INTERNAL' AND slug IN (" + slugs() + "))";
        String rooms = "(SELECT id FROM room_types WHERE hotel_id IN " + hotels + ")";
        List<UUID> ids = DevScenario.HOTELS.stream().map(DevScenario.HotelDef::id).toList();
        jdbcClient.sql("DELETE FROM review_reports WHERE review_id IN (SELECT id FROM reviews WHERE hotel_id IN "
                + hotels + ")").update();
        jdbcClient.sql("DELETE FROM reviews WHERE hotel_id IN " + hotels).update();
        jdbcClient.sql("DELETE FROM hotel_reservation_guests WHERE reservation_id IN "
                + "(SELECT id FROM hotel_reservations WHERE hotel_id IN " + hotels + ")").update();
        jdbcClient.sql("DELETE FROM hotel_reservations WHERE hotel_id IN " + hotels).update();
        jdbcClient.sql("DELETE FROM room_inventory WHERE room_type_id IN " + rooms).update();
        jdbcClient.sql("DELETE FROM rate_plans WHERE room_type_id IN " + rooms).update();
        jdbcClient.sql("DELETE FROM hotel_images WHERE hotel_id IN " + hotels).update();
        jdbcClient.sql("DELETE FROM room_type_amenities WHERE room_type_id IN " + rooms).update();
        jdbcClient.sql("DELETE FROM room_types WHERE hotel_id IN " + hotels).update();
        jdbcClient.sql("DELETE FROM hotel_staff WHERE hotel_id IN " + hotels).update();
        jdbcClient.sql("DELETE FROM hotels WHERE data_source = 'INTERNAL' AND slug IN (" + slugs() + ")").update();
        jdbcClient.sql("DELETE FROM known_users WHERE email LIKE 'dev.%@flighthotel.local'").update();
        ids.forEach(indexer::reindex);   // the hotels are gone: their search documents go too
    }

    private static String slugs() {
        return String.join(",", DevScenario.HOTELS.stream().map(h -> "'" + h.slug() + "'").toList());
    }

    private void seed() {
        context.getAutowireCapableBeanFactory().createBean(DevHotelSeeder.class).run(null);
    }

    private long count(String sql) {
        return jdbcClient.sql(sql).query(Long.class).single();
    }

    @Test
    void createsTheHotelsWithRoomsPlansInventoryAndTheManagersAssignments() {
        seed();

        assertThat(count("SELECT COUNT(*) FROM hotels WHERE slug IN (" + slugs() + ") AND status = 'ACTIVE' "
                + "AND data_source = 'INTERNAL'")).isEqualTo(3);
        assertThat(count("SELECT COUNT(*) FROM room_types WHERE hotel_id IN (SELECT id FROM hotels WHERE slug IN ("
                + slugs() + "))")).isEqualTo(6);
        assertThat(count("SELECT COUNT(*) FROM rate_plans WHERE room_type_id IN (SELECT id FROM room_types WHERE "
                + "hotel_id IN (SELECT id FROM hotels WHERE slug IN (" + slugs() + ")))")).isEqualTo(12);
        assertThat(count("SELECT COUNT(*) FROM hotel_images WHERE hotel_id IN (SELECT id FROM hotels WHERE slug IN ("
                + slugs() + "))")).isEqualTo(12);
        UUID room = DevScenario.hotel("arabian-sands").rooms().getFirst().id();
        assertThat(count("SELECT COUNT(*) FROM room_inventory WHERE room_type_id = UNHEX('"
                + hex(room) + "')")).isEqualTo(365);
        // manager1 manages two hotels, manager2 one.
        assertThat(count("SELECT COUNT(*) FROM hotel_staff WHERE user_id = UNHEX('"
                + hex(DevScenario.MANAGER1.id()) + "')")).isEqualTo(2);
        assertThat(count("SELECT COUNT(*) FROM hotel_staff WHERE user_id = UNHEX('"
                + hex(DevScenario.MANAGER2.id()) + "')")).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM known_users WHERE email LIKE 'dev.%@flighthotel.local'"))
                .isEqualTo(DevScenario.PEOPLE.size());
        // The search index knows the hotels (through the same path as a manager's change).
        assertThat(indexer.documentCount()).isGreaterThanOrEqualTo(3);
    }

    @Test
    void reservationsExistInEveryStateAndTheInventoryMatchesThem() {
        seed();
        LocalDate today = inventory.today();

        Map<String, Long> byStatus = new TreeMap<>();
        jdbcClient.sql("SELECT status, COUNT(*) AS n FROM hotel_reservations WHERE booking_reference LIKE 'HT-DEV%' "
                        + "GROUP BY status")
                .query((rs, i) -> byStatus.put(rs.getString("status"), rs.getLong("n"))).list();
        assertThat(byStatus).containsOnlyKeys("HELD", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "NO_SHOW",
                "CANCELLED");
        assertThat(byStatus.values().stream().mapToLong(Long::longValue).sum()).isEqualTo(DevScenario.STAYS.size());
        assertThat(count("SELECT COUNT(*) FROM hotel_reservations WHERE cancelled_by = 'HOTEL' AND booking_reference LIKE 'HT-DEV%'")).isEqualTo(1);
        // Guests are named for every room (h10 has two rooms).
        assertThat(count("SELECT COUNT(*) FROM hotel_reservation_guests WHERE reservation_id = UNHEX('"
                + hex(DevScenario.stay("h10").reservationId()) + "')")).isEqualTo(2);

        // h03 confirmed (1 room from today+12), h10 held (2 rooms from today+45), h06 in the house since yesterday.
        assertThat(night(DevScenario.stay("h03").roomDef().id(), today.plusDays(12), "booked_rooms")).isEqualTo(1);
        assertThat(night(DevScenario.stay("h03").roomDef().id(), today.plusDays(16), "booked_rooms")).isZero();
        assertThat(night(DevScenario.stay("h10").roomDef().id(), today.plusDays(45), "held_rooms")).isEqualTo(2);
        assertThat(night(DevScenario.stay("h06").roomDef().id(), today, "booked_rooms")).isEqualTo(1);
        assertThat(night(DevScenario.stay("h06").roomDef().id(), today.plusDays(2), "booked_rooms")).isZero();
        // Cancelled and past stays hold no rooms.
        assertThat(night(DevScenario.stay("h08").roomDef().id(), today.plusDays(20), "booked_rooms")).isZero();
        // Amounts follow the pricing rule: 12,900 a night is above the GST threshold (18%), 6,800 is not (5%).
        assertThat(count("SELECT COUNT(*) FROM hotel_reservations WHERE total_amount = subtotal + taxes")).isEqualTo(
                DevScenario.STAYS.size());
        assertThat(jdbcClient.sql("SELECT taxes FROM hotel_reservations WHERE booking_id = UNHEX('"
                + hex(DevScenario.stay("h01").bookingId()) + "')").query(java.math.BigDecimal.class).single())
                .isEqualByComparingTo("6966.00");   // 3 nights x 12,900 x 18%
    }

    @Test
    void reviewsHaveEveryStatusAndTheHotelRatingsFollowTheApprovedOnes() {
        long snapshotsBefore = reviewSnapshotRows();

        seed();

        Map<String, Long> byStatus = new TreeMap<>();
        jdbcClient.sql("SELECT status, COUNT(*) AS n FROM reviews WHERE booking_reference LIKE 'HT-DEV%' GROUP BY status")
                .query((rs, i) -> byStatus.put(rs.getString("status"), rs.getLong("n"))).list();
        assertThat(byStatus).containsEntry("APPROVED", 5L).containsEntry("PENDING", 1L).containsEntry("REJECTED", 1L);
        // arabian-sands: 5 and 3 -> 4.0 from 2; orchid-business: 4 and 5 -> 4.5 from 2; rajputana: 5 from 1.
        assertThat(rating("arabian-sands")).isEqualTo("4.0/2");
        assertThat(rating("orchid-business")).isEqualTo("4.5/2");
        assertThat(rating("rajputana-haveli")).isEqualTo("5.0/1");
        // Each new review's snapshot is published (hotel.events, for the review search).
        assertThat(reviewSnapshotRows() - snapshotsBefore)
                .isEqualTo(count("SELECT COUNT(*) FROM reviews WHERE booking_reference LIKE 'HT-DEV%'"));
    }

    @Test
    void aSecondRunCreatesNothingNew() {
        seed();
        long reservations = count("SELECT COUNT(*) FROM hotel_reservations");
        long reviews = count("SELECT COUNT(*) FROM reviews");
        long inventoryRows = count("SELECT COUNT(*) FROM room_inventory");
        long booked = count("SELECT COALESCE(SUM(booked_rooms + held_rooms), 0) FROM room_inventory");
        long hotels = count("SELECT COUNT(*) FROM hotels");
        long snapshots = reviewSnapshotRows();

        seed();

        assertThat(count("SELECT COUNT(*) FROM hotel_reservations")).isEqualTo(reservations);
        assertThat(count("SELECT COUNT(*) FROM reviews")).isEqualTo(reviews);
        assertThat(count("SELECT COUNT(*) FROM room_inventory")).isEqualTo(inventoryRows);
        assertThat(count("SELECT COALESCE(SUM(booked_rooms + held_rooms), 0) FROM room_inventory")).isEqualTo(booked);
        assertThat(count("SELECT COUNT(*) FROM hotels")).isEqualTo(hotels);
        assertThat(reviewSnapshotRows()).isEqualTo(snapshots);
    }

    @Test
    void nothingIsCreatedWhenTheSwitchIsOffOrTheProdProfileIsActive() {
        assertThat(context.getBeansOfType(DevHotelSeeder.class)).isEmpty();

        ConfigurableEnvironment environment = context.getEnvironment();
        String[] profiles = environment.getActiveProfiles();
        environment.setActiveProfiles("prod");
        try {
            seed();
        } finally {
            environment.setActiveProfiles(profiles);
        }
        assertThat(count("SELECT COUNT(*) FROM hotels WHERE slug IN (" + slugs() + ")")).isZero();
        assertThat(count("SELECT COUNT(*) FROM known_users WHERE email LIKE 'dev.%'")).isZero();
    }

    private int night(UUID roomTypeId, LocalDate date, String column) {
        return jdbcClient.sql("SELECT " + column + " FROM room_inventory WHERE room_type_id = UNHEX('" + hex(roomTypeId)
                + "') AND stay_date = :date").param("date", java.sql.Date.valueOf(date)).query(Integer.class).single();
    }

    private String rating(String hotelKey) {
        return jdbcClient.sql("SELECT CONCAT(avg_rating, '/', review_count) FROM hotels WHERE slug = :slug")
                .param("slug", DevScenario.hotel(hotelKey).slug()).query(String.class).single();
    }

    private static String hex(UUID id) {
        return java.util.HexFormat.of().formatHex(DevIds.bytes(id));
    }

    private long reviewSnapshotRows() {
        return jdbcClient.sql("SELECT COUNT(*) FROM outbox_events WHERE event_type = :type")
                .param("type", HotelReviewSnapshot.class.getName()).query(Long.class).single();
    }
}
