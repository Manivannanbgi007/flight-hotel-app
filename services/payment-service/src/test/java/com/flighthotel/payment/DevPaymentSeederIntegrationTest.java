package com.flighthotel.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;

import com.flighthotel.common.dev.DevScenario;
import com.flighthotel.payment.devseed.DevPaymentSeeder;

/**
 * The development payments: one payable booking per seeded booking, payment attempts in every final state, refunds
 * that add up and invoices; never twice; never when the switch is off or the prod profile is active. The seeder is
 * created by hand (the shared test context runs with the switch off) and its rows are removed after each test.
 */
class DevPaymentSeederIntegrationTest extends PaymentIntegrationTest {

    @Autowired
    ConfigurableApplicationContext context;

    @BeforeEach
    @AfterEach
    void removeDevRows() {
        String dev = "(SELECT booking_id FROM payable_bookings WHERE booking_reference LIKE '%-DEV%')";
        jdbcClient.sql("DELETE FROM invoices WHERE booking_id IN " + dev).update();
        jdbcClient.sql("DELETE FROM refunds WHERE booking_id IN " + dev).update();
        jdbcClient.sql("DELETE FROM payment_transactions WHERE booking_id IN " + dev).update();
        jdbcClient.sql("DELETE FROM payable_bookings WHERE booking_reference LIKE '%-DEV%'").update();
    }

    private void seed() {
        context.getAutowireCapableBeanFactory().createBean(DevPaymentSeeder.class).run(null);
    }

    private long count(String sql) {
        return jdbcClient.sql(sql).query(Long.class).single();
    }

    @Test
    void everySeededBookingHasItsPayableAndThePaymentAttemptsItShouldHave() {
        seed();
        int bookings = DevScenario.STAYS.size() + DevScenario.TRIPS.size();

        assertThat(count("SELECT COUNT(*) FROM payable_bookings WHERE booking_reference LIKE '%-DEV%'")).isEqualTo(bookings);
        Map<String, Long> payables = new TreeMap<>();
        jdbcClient.sql("SELECT status, COUNT(*) AS n FROM payable_bookings WHERE booking_reference LIKE '%-DEV%' "
                        + "GROUP BY status")
                .query((rs, i) -> payables.put(rs.getString("status"), rs.getLong("n"))).list();
        assertThat(payables).containsOnlyKeys("AWAITING_PAYMENT", "PAID");
        Map<String, Long> payments = new TreeMap<>();
        jdbcClient.sql("""
                        SELECT t.status, COUNT(*) AS n FROM payment_transactions t JOIN payable_bookings p
                          ON p.booking_id = t.booking_id WHERE p.booking_reference LIKE '%-DEV%' GROUP BY t.status""")
                .query((rs, i) -> payments.put(rs.getString("status"), rs.getLong("n"))).list();
        // No open attempt (INITIATED / PENDING): the reconciliation job would close it and tell booking-service.
        assertThat(payments).containsOnlyKeys("SUCCESS", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED");
        assertThat(count("SELECT COUNT(*) FROM payment_transactions WHERE provider <> 'DEMO' AND booking_id IN "
                + "(SELECT booking_id FROM payable_bookings WHERE booking_reference LIKE '%-DEV%')")).isZero();
        // The amount to pay is the booking's total.
        assertThat(jdbcClient.sql("SELECT amount FROM payable_bookings WHERE booking_reference = :ref")
                .param("ref", DevScenario.stay("h04").reference()).query(java.math.BigDecimal.class).single())
                .isEqualByComparingTo(DevScenario.stay("h04").price().total());
    }

    @Test
    void refundsAddUpInvoicesAreNumberedOnceAndCustomersSeeTheirPayments() throws Exception {
        seed();

        assertThat(count("""
                        SELECT COUNT(*) FROM payment_transactions t WHERE t.booking_id IN
                          (SELECT booking_id FROM payable_bookings WHERE booking_reference LIKE '%-DEV%')
                          AND t.refunded_amount <> COALESCE((SELECT SUM(r.amount) FROM refunds r
                            WHERE r.payment_id = t.id AND r.status = 'PROCESSED'), 0)""")).isZero();
        long cancelled = DevScenario.STAYS.stream().filter(s -> s.outcome().cancelled()).count()
                + DevScenario.TRIPS.stream().filter(t -> t.outcome().cancelled()).count();
        assertThat(count("SELECT COUNT(*) FROM refunds WHERE booking_id IN "
                + "(SELECT booking_id FROM payable_bookings WHERE booking_reference LIKE '%-DEV%')")).isEqualTo(cancelled);
        long paid = DevScenario.STAYS.stream().filter(s -> s.outcome().paid()).count()
                + DevScenario.TRIPS.stream().filter(t -> t.outcome().paid()).count();
        assertThat(count("SELECT COUNT(DISTINCT invoice_number) FROM invoices WHERE invoice_number LIKE 'INV/DEV/%'"))
                .isEqualTo(paid);
        assertThat(count("SELECT COUNT(*) FROM invoices WHERE total_amount <> taxable_amount + tax_amount")).isZero();

        // The real API: the owner reads the payment, the other customer does not.
        UUID paymentId = DevScenario.stay("h01").paymentId();
        getAs(DevScenario.CUSTOMER1.id(), "/api/payments/" + paymentId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingReference").value(DevScenario.stay("h01").reference()))
                .andExpect(jsonPath("$.status").value("SUCCESS"));
        getAs(DevScenario.CUSTOMER2.id(), "/api/payments/" + paymentId).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/admin/payments?q=" + DevScenario.stay("h07").reference())
                        .with(user(UUID.randomUUID(), Set.of("ADMIN"), Set.of("PAYMENT_READ_ANY"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].status").value("REFUNDED"));
    }

    @Test
    void aSecondRunCreatesNothingNew() {
        seed();
        long payables = count("SELECT COUNT(*) FROM payable_bookings");
        long payments = count("SELECT COUNT(*) FROM payment_transactions");
        long refunds = count("SELECT COUNT(*) FROM refunds");
        long invoices = count("SELECT COUNT(*) FROM invoices");

        seed();

        assertThat(count("SELECT COUNT(*) FROM payable_bookings")).isEqualTo(payables);
        assertThat(count("SELECT COUNT(*) FROM payment_transactions")).isEqualTo(payments);
        assertThat(count("SELECT COUNT(*) FROM refunds")).isEqualTo(refunds);
        assertThat(count("SELECT COUNT(*) FROM invoices")).isEqualTo(invoices);
    }

    @Test
    void nothingIsCreatedWhenTheSwitchIsOffOrTheProdProfileIsActive() {
        assertThat(context.getBeansOfType(DevPaymentSeeder.class)).isEmpty();

        ConfigurableEnvironment environment = context.getEnvironment();
        String[] profiles = environment.getActiveProfiles();
        environment.setActiveProfiles("prod");
        try {
            seed();
        } finally {
            environment.setActiveProfiles(profiles);
        }
        assertThat(count("SELECT COUNT(*) FROM payable_bookings WHERE booking_reference LIKE '%-DEV%'")).isZero();
    }
}
