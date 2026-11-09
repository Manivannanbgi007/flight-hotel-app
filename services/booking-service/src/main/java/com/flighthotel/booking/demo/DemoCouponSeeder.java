package com.flighthotel.booking.demo;

import java.math.BigDecimal;
import java.time.Instant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.booking.entity.Coupon;
import com.flighthotel.booking.entity.Offer;
import com.flighthotel.booking.repository.CouponRepository;
import com.flighthotel.booking.repository.OfferRepository;

/**
 * A few labelled demo coupons, and offers that advertise them on the home page, for local development and demos (never
 * in production). Existing codes and offer titles are left alone, so an admin's changes survive restarts.
 */
@Component
@ConditionalOnProperty(name = "booking.demo-data.enabled", havingValue = "true")
public class DemoCouponSeeder {

    private static final Logger log = LoggerFactory.getLogger(DemoCouponSeeder.class);
    private static final Instant FROM = Instant.parse("2026-01-01T00:00:00Z");
    private static final Instant TO = Instant.parse("2028-01-01T00:00:00Z");

    private final CouponRepository coupons;
    private final OfferRepository offers;
    private final TransactionTemplate transactions;

    public DemoCouponSeeder(CouponRepository coupons, OfferRepository offers, TransactionTemplate transactions) {
        this.coupons = coupons;
        this.offers = offers;
        this.transactions = transactions;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void seed() {
        int created = 0;
        created += create("WELCOME10", "10% off your first booking", "10% off hotels and flights, up to ₹1,500.",
                Coupon.PERCENT, "10", "1500", "2000", Coupon.ALL, null, 1);
        created += create("STAY500", "₹500 off hotel stays", "₹500 off any hotel booking of ₹4,000 or more.",
                Coupon.FIXED, "500", null, "4000", "HOTEL", null, 3);
        created += create("GOA15", "15% off stays in Goa", "15% off hotels in Goa, up to ₹3,000.",
                Coupon.PERCENT, "15", "3000", "3000", "HOTEL", "Goa", 2);
        if (created > 0) {
            log.info("Demo coupons created: {}", created);
        }
        int offered = 0;
        offered += offer("Your first trip, 10% off", "New here? Save 10% on your first hotel or flight booking.",
                "WELCOME10", Coupon.ALL, null, false, "OCEAN");
        offered += offer("Winter sun in Goa", "15% off beach stays in Goa this season, up to ₹3,000.", "GOA15",
                "HOTEL", "Goa", true, "SUNSET");
        offered += offer("₹500 off your stay", "Book any hotel for ₹4,000 or more and save ₹500.", "STAY500",
                "HOTEL", null, false, "FOREST");
        if (offered > 0) {
            log.info("Demo offers created: {}", offered);
        }
    }

    private int offer(String title, String description, String code, String appliesTo, String city,
            boolean seasonal, String theme) {
        Integer result = transactions.execute(status -> {
            Coupon coupon = coupons.findByCode(code).orElse(null);
            if (coupon == null || offers.existsByTitle(title)) {
                return 0;
            }
            Offer offer = new Offer();
            offer.setTitle(title);
            offer.setDescription(description);
            offer.setCouponId(coupon.getId());
            offer.setAppliesTo(appliesTo);
            offer.setDestinationCity(city);
            offer.setValidFrom(FROM);
            offer.setValidTo(TO);
            offer.setSeasonal(seasonal);
            offer.setTheme(theme);
            offer.setDemo(true);
            offers.save(offer);
            return 1;
        });
        return result == null ? 0 : result;
    }

    private int create(String code, String title, String description, String type, String value, String max,
            String min, String appliesTo, String city, int perCustomer) {
        Integer result = transactions.execute(status -> {
            if (coupons.existsByCode(code)) {
                return 0;
            }
            Coupon coupon = new Coupon(code);
            coupon.setTitle(title);
            coupon.setDescription(description + " Demo coupon.");
            coupon.setDiscountType(type);
            coupon.setDiscountValue(new BigDecimal(value));
            coupon.setMaxDiscount(max == null ? null : new BigDecimal(max));
            coupon.setMinBookingAmount(new BigDecimal(min));
            coupon.setAppliesTo(appliesTo);
            coupon.setDestinationCity(city);
            coupon.setValidFrom(FROM);
            coupon.setValidTo(TO);
            coupon.setPerCustomerLimit(perCustomer);
            coupon.setDemo(true);
            coupons.save(coupon);
            return 1;
        });
        return result == null ? 0 : result;
    }
}
