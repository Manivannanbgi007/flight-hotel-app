package com.flighthotel.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.TreeMap;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;

import com.flighthotel.booking.devseed.DevBookingSeeder;
import com.flighthotel.common.dev.DevScenario;

/**
 * The development bookings: every state for both customers, consistent amounts, the real API reads them, never twice,
 * never when the switch is off or the prod profile is active. The seeder is created by hand (the shared test context
 * runs with the switch off) and its rows are removed after each test.
 */
class DevBookingSeederIntegrationTest extends BookingIntegrationTest {

    @Autowired
    ConfigurableApplicationContext context;

    @BeforeEach
    @AfterEach
    void removeDevRows() {
        String dev = "(SELECT id FROM bookings WHERE booking_reference LIKE 'HT-DEV%' OR booking_reference LIKE 'FL-DEV%')";
        jdbcClient.sql("DELETE FROM booking_support_notes WHERE booking_id IN " + dev).update();
        jdbcClient.sql("DELETE FROM booking_refund_requests WHERE booking_id IN " + dev).update();
        jdbcClient.sql("DELETE FROM cancellations WHERE booking_id IN " + dev).update();
        jdbcClient.sql("DELETE FROM bookings WHERE booking_reference LIKE 'HT-DEV%' OR booking_reference LIKE 'FL-DEV%'")
                .update();
    }

    private void seed() {
        context.getAutowireCapableBeanFactory().createBean(DevBookingSeeder.class).run(null);
    }

    private long count(String sql) {
        return jdbcClient.sql(sql).query(Long.class).single();
    }

    @Test
    void bothCustomersHaveHotelAndFlightBookingsInEveryState() {
        seed();

        Map<String, Long> byStatus = new TreeMap<>();
        jdbcClient.sql("""
                        SELECT status, COUNT(*) AS n FROM bookings
                        WHERE booking_reference LIKE 'HT-DEV%' OR booking_reference LIKE 'FL-DEV%' GROUP BY status""")
                .query((rs, i) -> byStatus.put(rs.getString("status"), rs.getLong("n"))).list();
        assertThat(byStatus).containsOnlyKeys("PENDING_PAYMENT", "CONFIRMED", "COMPLETED", "REFUNDED");
        assertThat(byStatus.values().stream().mapToLong(Long::longValue).sum())
                .isEqualTo(DevScenario.STAYS.size() + DevScenario.TRIPS.size());
        assertThat(count("SELECT COUNT(*) FROM bookings WHERE booking_type = 'HOTEL' AND booking_reference LIKE 'HT-DEV%'"))
                .isEqualTo(DevScenario.STAYS.size());
        assertThat(count("SELECT COUNT(*) FROM bookings WHERE booking_type = 'FLIGHT' AND booking_reference LIKE 'FL-DEV%'"))
                .isEqualTo(DevScenario.TRIPS.size());
        for (String customer : new String[] {"dev.customer1@flighthotel.local", "dev.customer2@flighthotel.local"}) {
            assertThat(count("SELECT COUNT(DISTINCT booking_type) FROM bookings WHERE contact_email = '" + customer
                    + "' AND booking_reference LIKE '%-DEV%'")).isEqualTo(2);
        }
        // Payment states: unpaid, failed, paid, refunded and partly refunded all occur.
        Map<String, Long> payments = new TreeMap<>();
        jdbcClient.sql("SELECT payment_status, COUNT(*) AS n FROM bookings WHERE booking_reference LIKE '%-DEV%' "
                        + "GROUP BY payment_status")
                .query((rs, i) -> payments.put(rs.getString("payment_status"), rs.getLong("n"))).list();
        assertThat(payments).containsOnlyKeys("UNPAID", "PAYMENT_FAILED", "PAID", "REFUNDED", "PARTIALLY_REFUNDED");
        // The books add up: total = base + tax - discount, and price lines add up to the total.
        assertThat(count("SELECT COUNT(*) FROM bookings WHERE booking_reference LIKE '%-DEV%' "
                + "AND total_amount <> base_amount + tax_amount - discount_amount")).isZero();
        assertThat(count("""
                        SELECT COUNT(*) FROM bookings b WHERE b.booking_reference LIKE '%-DEV%' AND b.total_amount <>
                          (SELECT SUM(amount) FROM booking_price_items i WHERE i.booking_id = b.id)""")).isZero();
        // Every cancelled booking has its refund request; the partial refunds kept a fee.
        assertThat(count("SELECT COUNT(*) FROM booking_refund_requests r JOIN bookings b ON b.id = r.booking_id "
                + "WHERE b.booking_reference LIKE '%-DEV%'")).isEqualTo(
                DevScenario.STAYS.stream().filter(s -> s.outcome().cancelled()).count()
                        + DevScenario.TRIPS.stream().filter(t -> t.outcome().cancelled()).count());
        assertThat(count("SELECT COUNT(*) FROM bookings WHERE booking_reference LIKE '%-DEV%' "
                + "AND payment_status = 'PARTIALLY_REFUNDED' AND refunded_amount < total_amount")).isEqualTo(
                DevScenario.STAYS.stream().filter(s -> s.outcome() == DevScenario.Outcome.CANCELLED_PARTIAL).count()
                        + DevScenario.TRIPS.stream().filter(t -> t.outcome() == DevScenario.Outcome.CANCELLED_PARTIAL).count());
        // Guests and passengers.
        assertThat(count("SELECT COUNT(*) FROM booking_guests")).isGreaterThanOrEqualTo(DevScenario.STAYS.size());
        assertThat(count("SELECT COUNT(*) FROM booking_passengers p JOIN bookings b ON b.id = p.booking_id "
                + "WHERE b.booking_reference LIKE 'FL-DEV%'")).isEqualTo(
                DevScenario.TRIPS.stream().mapToLong(t -> t.travellers().size()).sum());
        // Each booking is published once for the reports.
        assertThat(count("SELECT COUNT(*) FROM outbox_events WHERE event_type LIKE '%BookingSnapshot'"))
                .isGreaterThanOrEqualTo(DevScenario.STAYS.size() + DevScenario.TRIPS.size());
    }

    @Test
    void theRealApiShowsTheSeededBookingsToTheirOwnerOnly() throws Exception {
        seed();
        DevScenario.Stay confirmed = DevScenario.stay("h03");
        DevScenario.Trip roundTrip = DevScenario.trip("f02");

        mockMvc.perform(get("/api/bookings/" + confirmed.bookingId()).with(customer(DevScenario.CUSTOMER1.id())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CONFIRMED"))
                .andExpect(jsonPath("$.reference").value(confirmed.reference()))
                .andExpect(jsonPath("$.totalAmount").value(confirmed.price().total().doubleValue()));
        mockMvc.perform(get("/api/bookings/" + roundTrip.bookingId()).with(customer(DevScenario.CUSTOMER1.id())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CONFIRMED"))
                .andExpect(jsonPath("$.flight.slices.length()").value(2))
                .andExpect(jsonPath("$.flight.passengers.length()").value(2));
        mockMvc.perform(get("/api/bookings/" + DevScenario.stay("h04").bookingId())
                        .with(customer(DevScenario.CUSTOMER1.id())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING_PAYMENT"));
        // My Trips tabs: customer1 has two upcoming and two pending-payment bookings.
        mockMvc.perform(get("/api/bookings?tab=UPCOMING").with(customer(DevScenario.CUSTOMER1.id())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(2));
        mockMvc.perform(get("/api/bookings?tab=PENDING").with(customer(DevScenario.CUSTOMER1.id())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(2));
        // Somebody else's booking does not exist for the other customer.
        mockMvc.perform(get("/api/bookings/" + confirmed.bookingId()).with(customer(DevScenario.CUSTOMER2.id())))
                .andExpect(status().isNotFound());
    }

    @Test
    void aSecondRunCreatesNothingNew() {
        seed();
        long bookings = count("SELECT COUNT(*) FROM bookings");
        long history = count("SELECT COUNT(*) FROM booking_status_history");
        long refunds = count("SELECT COUNT(*) FROM booking_refund_requests");
        long events = count("SELECT COUNT(*) FROM outbox_events");

        seed();

        assertThat(count("SELECT COUNT(*) FROM bookings")).isEqualTo(bookings);
        assertThat(count("SELECT COUNT(*) FROM booking_status_history")).isEqualTo(history);
        assertThat(count("SELECT COUNT(*) FROM booking_refund_requests")).isEqualTo(refunds);
        assertThat(count("SELECT COUNT(*) FROM outbox_events")).isEqualTo(events);
    }

    @Test
    void nothingIsCreatedWhenTheSwitchIsOffOrTheProdProfileIsActive() {
        assertThat(context.getBeansOfType(DevBookingSeeder.class)).isEmpty();

        ConfigurableEnvironment environment = context.getEnvironment();
        String[] profiles = environment.getActiveProfiles();
        environment.setActiveProfiles("prod");
        try {
            seed();
        } finally {
            environment.setActiveProfiles(profiles);
        }
        assertThat(count("SELECT COUNT(*) FROM bookings WHERE booking_reference LIKE '%-DEV%'")).isZero();
    }
}
