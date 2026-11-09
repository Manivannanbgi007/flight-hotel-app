package com.flighthotel.flight;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.Map;
import java.util.TreeMap;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;

import com.flighthotel.common.dev.DevIds;
import com.flighthotel.common.dev.DevScenario;
import com.flighthotel.flight.dto.FlightDtos.TripOffer;
import com.flighthotel.flight.integration.demo.DevFlightSeeder;
import com.flighthotel.flight.integration.demo.ReferenceData;

import tools.jackson.databind.json.JsonMapper;

/**
 * The development flights: the dev timetable and the airline-side records of the seeded flight bookings, with the ids,
 * PNRs and amounts booking-service uses; never twice; never when the switch is off or the prod profile is active. The
 * seeder is created by hand (the shared test context runs with the switch off) and its rows are removed after each test.
 */
class DevFlightSeederIntegrationTest extends FlightIntegrationTest {

    @Autowired
    ConfigurableApplicationContext context;

    @Autowired
    ReferenceData reference;

    @Autowired
    JsonMapper json;

    @BeforeEach
    @AfterEach
    void removeDevRows() {
        String numbers = String.join(",", DevScenario.FLIGHTS.stream().map(f -> "'" + f.number() + "'").toList());
        jdbcClient.sql("""
                        DELETE d FROM demo_orders d JOIN flight_supplier_bookings b ON b.idempotency_key = d.idempotency_key
                        WHERE b.booking_reference LIKE 'FL-DEV%'""").update();
        jdbcClient.sql("DELETE FROM flight_supplier_bookings WHERE booking_reference LIKE 'FL-DEV%'").update();
        jdbcClient.sql("DELETE FROM demo_seat_inventory WHERE schedule_id IN "
                + "(SELECT id FROM demo_flight_schedules WHERE flight_number IN (" + numbers + "))").update();
        jdbcClient.sql("DELETE FROM demo_flight_schedules WHERE flight_number IN (" + numbers + ")").update();
        reference.refresh();
    }

    private void seed() {
        context.getAutowireCapableBeanFactory().createBean(DevFlightSeeder.class).run(null);
    }

    private long count(String sql) {
        return jdbcClient.sql(sql).query(Long.class).single();
    }

    @Test
    void addsTheDevTimetableAndASupplierBookingForEveryFlightBooking() throws Exception {
        seed();

        assertThat(reference.schedules("DEL", "BOM")).extracting(ReferenceData.Schedule::flightNumber)
                .contains("6E 7101");
        assertThat(reference.schedule(DevScenario.flight("blr-del").scheduleId().toString())).isNotNull();
        Map<String, Long> byStatus = new TreeMap<>();
        jdbcClient.sql("SELECT status, COUNT(*) AS n FROM flight_supplier_bookings WHERE booking_reference LIKE 'FL-DEV%' "
                        + "GROUP BY status")
                .query((rs, i) -> byStatus.put(rs.getString("status"), rs.getLong("n"))).list();
        assertThat(byStatus).containsEntry("HELD", 2L).containsEntry("CONFIRMED", 4L).containsEntry("CANCELLED", 1L)
                .hasSize(3);
        // The trip is stored as priced, and matches the booking's total.
        String tripJson = jdbcClient.sql("SELECT trip_json FROM flight_supplier_bookings WHERE booking_id = :id")
                .param("id", DevIds.bytes(DevScenario.trip("f02").bookingId())).query(String.class).single();
        TripOffer trip = json.readValue(tripJson, TripOffer.class);
        assertThat(trip.slices()).hasSize(2);
        assertThat(trip.total()).isEqualByComparingTo(DevScenario.trip("f02").price().total());
        // Tickets and the airline's orders exist for paid bookings only; the PNR is the one booking-service shows.
        assertThat(count("SELECT COUNT(*) FROM flight_supplier_tickets t JOIN flight_supplier_bookings b "
                + "ON b.booking_id = t.booking_id WHERE b.booking_reference LIKE 'FL-DEV%'")).isEqualTo(
                DevScenario.TRIPS.stream().filter(t -> t.outcome().paid()).mapToLong(t -> t.travellers().size()).sum());
        assertThat(jdbcClient.sql("SELECT pnr FROM demo_orders WHERE idempotency_key = :key")
                .param("key", DevScenario.trip("f03").bookingId().toString()).query(String.class).single())
                .isEqualTo(DevScenario.trip("f03").pnr());
        assertThat(jdbcClient.sql("SELECT status FROM demo_orders WHERE idempotency_key = :key")
                .param("key", DevScenario.trip("f05").bookingId().toString()).query(String.class).single())
                .isEqualTo("CANCELLED");
    }

    @Test
    void theSeatsSoldHeldAndGivenBackMatchTheBookings() {
        seed();
        LocalDate today = LocalDate.now(DevScenario.INDIA);

        // f06 flew (1 seat sold), f03 is confirmed (adult + child), f04 waits for payment (1 held), f05 was cancelled.
        assertThat(seats("del-bom", today.minusDays(30), "seats_sold")).isEqualTo(1);
        assertThat(seats("bom-goi", today.plusDays(3), "seats_sold")).isEqualTo(2);
        assertThat(seats("hyd-maa", today.plusDays(45), "seats_held")).isEqualTo(1);
        assertThat(seats("hyd-maa", today.plusDays(45), "seats_sold")).isZero();
        assertThat(seats("maa-blr", today.minusDays(50), "seats_sold")).isZero();
        assertThat(count("SELECT COUNT(*) FROM demo_seat_inventory WHERE seats_held + seats_sold > seats_total")).isZero();
    }

    @Test
    void aSecondRunCreatesNothingNew() {
        seed();
        long schedules = count("SELECT COUNT(*) FROM demo_flight_schedules");
        long bookings = count("SELECT COUNT(*) FROM flight_supplier_bookings");
        long sold = count("SELECT COALESCE(SUM(seats_sold + seats_held), 0) FROM demo_seat_inventory");
        long orders = count("SELECT COUNT(*) FROM demo_orders");

        seed();

        assertThat(count("SELECT COUNT(*) FROM demo_flight_schedules")).isEqualTo(schedules);
        assertThat(count("SELECT COUNT(*) FROM flight_supplier_bookings")).isEqualTo(bookings);
        assertThat(count("SELECT COALESCE(SUM(seats_sold + seats_held), 0) FROM demo_seat_inventory")).isEqualTo(sold);
        assertThat(count("SELECT COUNT(*) FROM demo_orders")).isEqualTo(orders);
    }

    @Test
    void nothingIsCreatedWhenTheSwitchIsOffOrTheProdProfileIsActive() {
        assertThat(context.getBeansOfType(DevFlightSeeder.class)).isEmpty();

        ConfigurableEnvironment environment = context.getEnvironment();
        String[] profiles = environment.getActiveProfiles();
        environment.setActiveProfiles("prod");
        try {
            seed();
        } finally {
            environment.setActiveProfiles(profiles);
        }
        assertThat(count("SELECT COUNT(*) FROM flight_supplier_bookings WHERE booking_reference LIKE 'FL-DEV%'")).isZero();
        assertThat(count("SELECT COUNT(*) FROM demo_flight_schedules WHERE flight_number = '6E 7101'")).isZero();
    }

    private int seats(String flightKey, LocalDate date, String column) {
        return jdbcClient.sql("SELECT " + column + " FROM demo_seat_inventory WHERE schedule_id = :id "
                        + "AND flight_date = :date AND cabin = 'ECONOMY'")
                .param("id", DevIds.bytes(DevScenario.flight(flightKey).scheduleId()))
                .param("date", java.sql.Date.valueOf(date)).query(Integer.class).single();
    }
}
