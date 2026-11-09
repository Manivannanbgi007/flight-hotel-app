package com.flighthotel.notification.email;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;

import org.junit.jupiter.api.Test;

/** Amounts in booking e-mails and PDF documents: rupees with Indian grouping, like the website shows them. */
class BookingEmailAmountsTest {

    @Test
    void rupeesUseIndianGroupingAndOtherCurrenciesTheirCode() {
        assertThat(BookingEmailComposer.format(new BigDecimal("2625"), "INR")).isEqualTo("₹2,625.00");
        assertThat(BookingEmailComposer.format(new BigDecimal("250000"), "INR")).isEqualTo("₹2,50,000.00");
        assertThat(BookingEmailComposer.format(new BigDecimal("12345678.905"), "INR")).isEqualTo("₹1,23,45,678.90");
        assertThat(BookingEmailComposer.format(new BigDecimal("1499.5"), "USD")).isEqualTo("USD 1,499.50");
        assertThat(BookingEmailComposer.format(BigDecimal.ZERO, "INR")).isEqualTo("₹0.00");
    }
}
