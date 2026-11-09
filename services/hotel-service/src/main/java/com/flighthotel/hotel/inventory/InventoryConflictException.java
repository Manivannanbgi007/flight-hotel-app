package com.flighthotel.hotel.inventory;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;

import com.flighthotel.common.error.ApiException;

/** 409: the room count would drop below the rooms already booked or held on these nights. */
public class InventoryConflictException extends ApiException {

    public InventoryConflictException(List<LocalDate> nights) {
        super(HttpStatus.CONFLICT, "INVENTORY_BELOW_RESERVED",
                "Some nights already have more rooms booked or held than the new number.",
                Map.of("nights", nights.stream().limit(31).map(LocalDate::toString).toList()));
    }
}
