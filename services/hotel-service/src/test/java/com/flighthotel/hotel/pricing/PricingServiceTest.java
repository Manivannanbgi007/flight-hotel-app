package com.flighthotel.hotel.pricing;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.flighthotel.common.settings.SystemSettings;
import com.flighthotel.events.settings.SystemSettingChanged;
import com.flighthotel.hotel.entity.DataSource;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.PropertyType;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.SeasonalRate;
import com.flighthotel.hotel.pricing.PricingService.StayPrice;

class PricingServiceTest {

    private static final LocalDate MONDAY = LocalDate.of(2027, 3, 1);

    private final SystemSettings settings = new SystemSettings();
    /** Two weeks before the test stays. */
    private final PricingService pricing = new PricingService(settings,
            java.time.Clock.fixed(Instant.parse("2027-02-15T00:00:00Z"), java.time.ZoneOffset.UTC));

    @Test
    void seasonalPriceOverridesBaseAndGstFollowsTheSlab() {
        RatePlan plan = plan(BigDecimal.valueOf(7000));
        // Night 2 is in season at 8000 (> 7500 threshold → 18 % GST); others base price 7000 (5 %).
        SeasonalRate season = new SeasonalRate(plan.getId(), "Festival", MONDAY.plusDays(1), MONDAY.plusDays(1),
                BigDecimal.valueOf(8000), 0, Instant.now(), "test");

        StayPrice price = pricing.price(plan, List.of(season), MONDAY, MONDAY.plusDays(3), 2);

        assertThat(price.nights()).extracting(PricingService.NightPrice::price)
                .containsExactly(new BigDecimal("7000"), new BigDecimal("8000"), new BigDecimal("7000"));
        assertThat(price.nights().get(1).season()).isEqualTo("Festival");
        assertThat(price.subtotal()).isEqualByComparingTo("44000");          // (7000 + 8000 + 7000) × 2 rooms
        assertThat(price.taxes()).isEqualByComparingTo("4280");              // (350 + 1440 + 350) × 2
        assertThat(price.total()).isEqualByComparingTo("48280");
        assertThat(price.pricePerNight()).isEqualByComparingTo("7333.33");   // per room per night
    }

    @Test
    void higherPriorityWinsWhenSeasonsOverlap() {
        RatePlan plan = plan(BigDecimal.valueOf(5000));
        SeasonalRate broad = new SeasonalRate(plan.getId(), "Winter", MONDAY, MONDAY.plusDays(30),
                BigDecimal.valueOf(6000), 1, Instant.parse("2026-01-01T00:00:00Z"), "test");
        SeasonalRate peak = new SeasonalRate(plan.getId(), "Holi", MONDAY.plusDays(2), MONDAY.plusDays(2),
                BigDecimal.valueOf(9000), 5, Instant.parse("2025-01-01T00:00:00Z"), "test");

        StayPrice price = pricing.price(plan, List.of(broad, peak), MONDAY, MONDAY.plusDays(3), 1);

        assertThat(price.nights()).extracting(PricingService.NightPrice::price)
                .containsExactly(new BigDecimal("6000"), new BigDecimal("6000"), new BigDecimal("9000"));
    }

    @Test
    void gstRatesComeFromSystemSettings() {
        settings.apply(SystemSettingChanged.newBuilder().setKey("hotel.gst.rate-up-to-threshold").setValue("12").setValueType("DECIMAL")
                .setVersion(1).setChangedBy("admin").setChangedAt(Instant.now()).build());

        StayPrice price = pricing.price(plan(BigDecimal.valueOf(1000)), List.of(), MONDAY, MONDAY.plusDays(1), 1);

        assertThat(price.taxes()).isEqualByComparingTo("120");
    }

    @Test
    void cancellationTermsInPlainWords() {
        Hotel hotel = new Hotel("Test", "test", PropertyType.HOTEL, "Road 1", "Goa", "IN", DataSource.INTERNAL);
        hotel.setCheckInTime(LocalTime.of(14, 0));

        RatePlan flexible = plan(BigDecimal.TEN);
        flexible.setCancellation(true, 48, BigDecimal.valueOf(100));
        var terms = pricing.cancellation(flexible, hotel, MONDAY);
        assertThat(terms.freeCancellation()).isTrue();
        assertThat(terms.freeUntil()).isEqualTo(Instant.parse("2027-02-27T08:30:00Z")); // 14:00 IST - 48 h
        assertThat(terms.description()).isEqualTo(
                "Free cancellation until 27 Feb 2027, 14:00 (hotel local time); after that the full amount is charged.");
        assertThat(PricingService.summary(flexible)).isEqualTo("Free cancellation until 2 days before check-in");

        RatePlan saver = plan(BigDecimal.TEN);
        saver.setCancellation(false, null, null);
        assertThat(pricing.cancellation(saver, hotel, MONDAY).freeCancellation()).isFalse();
        assertThat(PricingService.summary(saver)).isEqualTo("Non-refundable");
    }

    @Test
    void aFreePeriodThatAlreadyEndedForTheseDatesIsNotOfferedAsFree() {
        Hotel hotel = new Hotel("Test", "test", PropertyType.HOTEL, "Road 1", "Goa", "IN", DataSource.INTERNAL);
        hotel.setCheckInTime(LocalTime.of(14, 0));
        RatePlan flexible = plan(BigDecimal.TEN);
        flexible.setCancellation(true, 48, BigDecimal.valueOf(100));
        // Booked a day before check-in: the 48-hour free period ended yesterday.
        PricingService lastMinute = new PricingService(settings,
                java.time.Clock.fixed(Instant.parse("2027-02-28T09:00:00Z"), java.time.ZoneOffset.UTC));

        var terms = lastMinute.cancellation(flexible, hotel, MONDAY);

        assertThat(terms.freeCancellation()).isFalse();
        assertThat(terms.freeUntil()).isEqualTo(Instant.parse("2027-02-27T08:30:00Z"));
        assertThat(terms.description()).isEqualTo("The free cancellation period for these dates ended on 27 Feb 2027, "
                + "14:00 (hotel local time): the full amount is charged if you cancel.");
        // A plan without any fee stays free whenever it is booked.
        flexible.setCancellation(true, 48, BigDecimal.ZERO);
        assertThat(lastMinute.cancellation(flexible, hotel, MONDAY).freeCancellation()).isTrue();
    }

    private static RatePlan plan(BigDecimal base) {
        RatePlan plan = new RatePlan(UUID.randomUUID());
        org.springframework.test.util.ReflectionTestUtils.setField(plan, "id", UUID.randomUUID());
        plan.setName("Test plan");
        plan.setBasePricePerNight(base);
        plan.setCancellation(true, 24, BigDecimal.valueOf(50));
        return plan;
    }
}
