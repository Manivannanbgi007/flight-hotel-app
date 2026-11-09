package com.flighthotel.booking.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;

import org.junit.jupiter.api.Test;

/** Amounts in customer-facing texts (fee descriptions, coupon notes, e-mails): Indian digit grouping. */
class AmountsTest {

    @Test
    void wholeAmountsHaveNoDecimalsAndOthersHaveTwo() {
        assertThat(Amounts.format(new BigDecimal("200000.00"), "INR")).isEqualTo("₹2,00,000");
        assertThat(Amounts.format(new BigDecimal("1499.5"), "INR")).isEqualTo("₹1,499.50");
        assertThat(Amounts.format(new BigDecimal("12345678.90"), "INR")).isEqualTo("₹1,23,45,678.90");
        assertThat(Amounts.format(BigDecimal.ZERO, "INR")).isEqualTo("₹0");
    }
}
