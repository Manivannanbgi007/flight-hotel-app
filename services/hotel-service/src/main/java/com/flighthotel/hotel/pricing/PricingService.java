package com.flighthotel.hotel.pricing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import org.springframework.stereotype.Component;

import com.flighthotel.common.settings.SystemSettings;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.SeasonalRate;

/**
 * Prices a stay: the price of each night (seasonal price if one covers the night, otherwise the base price), times
 * the number of rooms, plus GST.
 * <p>
 * GST (assumption A9, System Settings): per room per night, {@code hotel.gst.rate-up-to-threshold} % for prices up
 * to {@code hotel.gst.threshold-per-night}, otherwise {@code hotel.gst.rate-above-threshold} %. Admins can change
 * the values at runtime.
 */
@Component
public class PricingService {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final DateTimeFormatter DEADLINE = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.ENGLISH);

    private final SystemSettings settings;
    private final java.time.Clock clock;

    public PricingService(SystemSettings settings, java.time.Clock clock) {
        this.settings = settings;
        this.clock = clock;
    }

    /** @param seasonalRates seasonal prices of this plan (others are ignored) */
    public StayPrice price(RatePlan plan, List<SeasonalRate> seasonalRates, LocalDate checkIn, LocalDate checkOut,
            int rooms) {
        BigDecimal threshold = settings.getDecimal("hotel.gst.threshold-per-night", BigDecimal.valueOf(7500));
        BigDecimal lowRate = settings.getDecimal("hotel.gst.rate-up-to-threshold", BigDecimal.valueOf(5));
        BigDecimal highRate = settings.getDecimal("hotel.gst.rate-above-threshold", BigDecimal.valueOf(18));
        BigDecimal roomCount = BigDecimal.valueOf(rooms);

        List<SeasonalRate> applicable = seasonalRates.stream()
                .filter(rate -> rate.getRatePlanId().equals(plan.getId()))
                // Highest priority first; among equals the newest (most recently entered) wins.
                .sorted(Comparator.comparingInt(SeasonalRate::getPriority).reversed()
                        .thenComparing(SeasonalRate::getCreatedAt, Comparator.reverseOrder()))
                .toList();

        List<NightPrice> nights = new ArrayList<>();
        BigDecimal subtotal = BigDecimal.ZERO;
        BigDecimal taxes = BigDecimal.ZERO;
        for (LocalDate night = checkIn; night.isBefore(checkOut); night = night.plusDays(1)) {
            LocalDate current = night;
            SeasonalRate season = applicable.stream().filter(rate -> rate.covers(current)).findFirst().orElse(null);
            BigDecimal price = season != null ? season.getPricePerNight() : plan.getBasePricePerNight();
            BigDecimal taxRate = price.compareTo(threshold) <= 0 ? lowRate : highRate;
            BigDecimal taxPerRoom = price.multiply(taxRate).divide(HUNDRED, 2, RoundingMode.HALF_UP);
            nights.add(new NightPrice(night, price, season == null ? null : season.getLabel(), taxRate));
            subtotal = subtotal.add(price.multiply(roomCount));
            taxes = taxes.add(taxPerRoom.multiply(roomCount));
        }
        int nightCount = nights.size();
        BigDecimal perNight = nightCount == 0 ? BigDecimal.ZERO
                : subtotal.divide(BigDecimal.valueOf((long) nightCount * rooms), 2, RoundingMode.HALF_UP);
        return new StayPrice(nights, rooms, perNight, subtotal.setScale(2, RoundingMode.HALF_UP),
                taxes.setScale(2, RoundingMode.HALF_UP), subtotal.add(taxes).setScale(2, RoundingMode.HALF_UP),
                plan.getCurrency());
    }

    /**
     * The cancellation terms of a plan for a concrete stay, in plain words. {@code freeCancellation} is about this stay
     * booked now: a free period that has already ended for these dates (check-in soon) is not free any more.
     */
    public CancellationTerms cancellation(RatePlan plan, Hotel hotel, LocalDate checkIn) {
        if (!plan.hasFreeCancellation()) {
            BigDecimal fee = plan.getCancellationFeePercent();
            String text = fee.compareTo(HUNDRED) >= 0 ? "Non-refundable: the full amount is charged if you cancel."
                    : "Cancellation fee: " + fee.stripTrailingZeros().toPlainString() + "% of the total.";
            return new CancellationTerms(false, null, fee, text);
        }
        ZoneId zone = ZoneId.of(hotel.getTimeZone());
        ZonedDateTime freeUntil = LocalDateTime.of(checkIn, hotel.getCheckInTime()).atZone(zone)
                .minusHours(plan.getFreeCancellationHours());
        BigDecimal fee = plan.getCancellationFeePercent();
        if (fee.signum() > 0 && !clock.instant().isBefore(freeUntil.toInstant())) {
            String charged = fee.compareTo(HUNDRED) >= 0 ? "the full amount is charged"
                    : fee.stripTrailingZeros().toPlainString() + "% of the total is charged";
            return new CancellationTerms(false, freeUntil.toInstant(), fee, "The free cancellation period for these "
                    + "dates ended on " + DEADLINE.format(freeUntil) + " (hotel local time): " + charged
                    + " if you cancel.");
        }
        String after = fee.signum() == 0 ? "and free afterwards too."
                : fee.compareTo(HUNDRED) >= 0 ? "after that the full amount is charged."
                : "after that " + fee.stripTrailingZeros().toPlainString() + "% of the total is charged.";
        return new CancellationTerms(true, freeUntil.toInstant(), fee,
                "Free cancellation until " + DEADLINE.format(freeUntil) + " (hotel local time); " + after);
    }

    /** Plan-level summary without dates (manager screens, search cards). */
    public static String summary(RatePlan plan) {
        if (!plan.hasFreeCancellation()) {
            return plan.getCancellationFeePercent().compareTo(HUNDRED) >= 0 ? "Non-refundable"
                    : "Cancellation fee " + plan.getCancellationFeePercent().stripTrailingZeros().toPlainString() + "%";
        }
        int hours = plan.getFreeCancellationHours();
        String window = hours == 0 ? "until check-in"
                : hours % 24 == 0 ? "until " + (hours / 24) + (hours == 24 ? " day" : " days") + " before check-in"
                : "until " + hours + " hours before check-in";
        return "Free cancellation " + window;
    }

    public record NightPrice(LocalDate date, BigDecimal price, String season, BigDecimal taxRatePercent) {
    }

    /**
     * @param pricePerNight average price per room per night, before taxes
     * @param subtotal      all nights × rooms, before taxes
     */
    public record StayPrice(List<NightPrice> nights, int rooms, BigDecimal pricePerNight, BigDecimal subtotal,
                            BigDecimal taxes, BigDecimal total, String currency) {
    }

    /** @param freeUntil last moment to cancel for free (null if never free) */
    public record CancellationTerms(boolean freeCancellation, java.time.Instant freeUntil, BigDecimal feePercent,
                                    String description) {
    }
}
