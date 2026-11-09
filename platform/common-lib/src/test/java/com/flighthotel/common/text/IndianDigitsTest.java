package com.flighthotel.common.text;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class IndianDigitsTest {

    @Test
    void groupsTheLastThreeDigitsThenPairs() {
        assertThat(IndianDigits.group("200000")).isEqualTo("2,00,000");
        assertThat(IndianDigits.group("12345678.90")).isEqualTo("1,23,45,678.90");
        assertThat(IndianDigits.group("1499.50")).isEqualTo("1,499.50");
        assertThat(IndianDigits.group("100000000")).isEqualTo("10,00,00,000");
    }

    @Test
    void keepsSymbolsSignsAndShortNumbersAsTheyAre() {
        assertThat(IndianDigits.group("₹250000.00")).isEqualTo("₹2,50,000.00");
        assertThat(IndianDigits.group("-₹1234567")).isEqualTo("-₹12,34,567");
        assertThat(IndianDigits.group("US$ 1234567.5")).isEqualTo("US$ 12,34,567.5");
        assertThat(IndianDigits.group("999.99")).isEqualTo("999.99");
        assertThat(IndianDigits.group("0")).isEqualTo("0");
        assertThat(IndianDigits.group("")).isEmpty();
    }
}
