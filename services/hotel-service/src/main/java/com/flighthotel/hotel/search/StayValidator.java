package com.flighthotel.hotel.search;

import static java.time.temporal.ChronoUnit.DAYS;

import java.time.LocalDate;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.hotel.dto.PublicHotelDtos.Stay;
import com.flighthotel.hotel.inventory.InventoryService;

/** Rules for a stay that need "today" or several fields: dates in the sellable window, max 30 nights, ages. */
@Component
public class StayValidator {

    public static final int MAX_NIGHTS = 30;

    private final InventoryService inventory;

    public StayValidator(InventoryService inventory) {
        this.inventory = inventory;
    }

    public void validate(Stay stay) {
        LocalDate today = inventory.today();
        if (stay.checkIn().isBefore(today)) {
            throw invalid("checkIn", "Check-in cannot be in the past.");
        }
        if (!stay.checkOut().isAfter(stay.checkIn())) {
            throw invalid("checkOut", "Check-out must be after check-in.");
        }
        if (DAYS.between(stay.checkIn(), stay.checkOut()) > MAX_NIGHTS) {
            throw invalid("checkOut", "A stay can be at most " + MAX_NIGHTS + " nights.");
        }
        if (stay.checkOut().isAfter(inventory.lastSellableNight().plusDays(1))) {
            throw invalid("checkOut", "Rooms can be booked up to " + InventoryService.HORIZON_DAYS + " days ahead.");
        }
        if (stay.adults() < stay.rooms()) {
            throw invalid("adults", "Every room needs at least one adult.");
        }
        int ages = stay.childAges() == null ? 0 : stay.childAges().size();
        if (stay.children() > 0 && ages != stay.children()) {
            throw invalid("childAges", "Please give the age of each child.");
        }
    }

    private static ApiException invalid(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_STAY", message, Map.of("field", field));
    }
}
