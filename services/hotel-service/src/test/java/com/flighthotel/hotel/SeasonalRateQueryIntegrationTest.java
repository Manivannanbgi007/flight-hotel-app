package com.flighthotel.hotel;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.hotel.entity.SeasonalRate;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.HotelReservationRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.repository.SeasonalRateRepository;

/**
 * Which seasonal prices a stay uses (search, quote, reservation and the inventory calendar all ask this query): a
 * season counts when it covers at least one of the nights [check-in, check-out). Its end date is its last night.
 */
class SeasonalRateQueryIntegrationTest extends HotelIntegrationTest {

    @Autowired
    TransactionTemplate transactions;

    @Autowired
    HotelRepository hotels;

    @Autowired
    RoomTypeRepository roomTypes;

    @Autowired
    RatePlanRepository ratePlans;

    @Autowired
    HotelReservationRepository reservations;

    @Autowired
    SeasonalRateRepository seasonalRates;

    @Test
    void aSeasonCountsWhenItCoversAtLeastOneNightOfTheStay() {
        TestStays stays = new TestStays(transactions, hotels, roomTypes, ratePlans, reservations, inventory, jdbcClient);
        UUID hotel = stays.hotel("Season Hotel", "Seasonville").getId();
        LocalDate checkIn = inventory.today().plusDays(60);
        LocalDate checkOut = checkIn.plusDays(3);   // nights: checkIn, +1, +2
        UUID plan = stays.room(hotel, 2, "3000.00", checkIn, checkOut).ratePlanId();
        UUID otherPlan = stays.room(hotel, 2, "3000.00", checkIn, checkOut).ratePlanId();

        season(plan, "ends the night before", checkIn.minusDays(5), checkIn.minusDays(1));
        SeasonalRate endsOnFirstNight = season(plan, "ends on the first night", checkIn.minusDays(5), checkIn);
        SeasonalRate oneNightInside = season(plan, "one night inside", checkIn.plusDays(1), checkIn.plusDays(1));
        SeasonalRate startsOnLastNight = season(plan, "starts on the last night", checkIn.plusDays(2), checkOut.plusDays(9));
        season(plan, "starts on check-out day", checkOut, checkOut.plusDays(9));
        SeasonalRate covering = season(plan, "covers everything", checkIn.minusDays(30), checkOut.plusDays(30));
        season(otherPlan, "another room's season", checkIn.minusDays(30), checkOut.plusDays(30));

        List<SeasonalRate> found = seasonalRates.findOverlapping(List.of(plan), checkIn, checkOut);

        assertThat(found).extracting(SeasonalRate::getId).containsExactlyInAnyOrder(endsOnFirstNight.getId(),
                oneNightInside.getId(), startsOnLastNight.getId(), covering.getId());
        // Several plans at once (the search asks for all plans of the hotels it shows).
        assertThat(seasonalRates.findOverlapping(List.of(plan, otherPlan), checkIn, checkOut)).hasSize(5);
        // A one-night stay on the night before check-in sees only the seasons of that night.
        assertThat(seasonalRates.findOverlapping(List.of(plan), checkIn.minusDays(1), checkIn))
                .extracting(SeasonalRate::getLabel)
                .containsExactlyInAnyOrder("ends the night before", "ends on the first night", "covers everything");
    }

    private SeasonalRate season(UUID plan, String label, LocalDate start, LocalDate end) {
        return seasonalRates.save(new SeasonalRate(plan, label, start, end, new BigDecimal("4500.00"), 1,
                Instant.now(), "test"));
    }
}
