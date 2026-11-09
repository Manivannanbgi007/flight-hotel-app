package com.flighthotel.booking.entity;

import java.math.BigDecimal;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** One line of the price breakdown ("Room charges", "GST 5%", "Coupon WELCOME10"). Discounts are negative. */
@Getter
@Embeddable
@AllArgsConstructor
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PriceItem {

    public static final String ROOM = "ROOM";
    /** Flight fares (hotels: ROOM). */
    public static final String FARE = "FARE";
    /** Airline fuel and airport charges. */
    public static final String FEE = "FEE";
    public static final String TAX = "TAX";
    public static final String DISCOUNT = "DISCOUNT";

    @Column(name = "item_type", nullable = false, length = 20)
    private String itemType;

    @Column(nullable = false, length = 120)
    private String label;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;
}
