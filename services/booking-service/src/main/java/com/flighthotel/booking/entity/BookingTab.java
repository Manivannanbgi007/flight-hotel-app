package com.flighthotel.booking.entity;

import java.util.Arrays;
import java.util.EnumSet;
import java.util.Set;
import java.util.stream.Collectors;

/** My Trips tabs (requirement §12). */
public enum BookingTab {
    ALL, PENDING, UPCOMING, COMPLETED, CANCELLED;

    public Set<BookingStatus> statuses() {
        if (this == ALL) {
            return EnumSet.allOf(BookingStatus.class);
        }
        return Arrays.stream(BookingStatus.values()).filter(status -> status.tab() == this)
                .collect(Collectors.toCollection(() -> EnumSet.noneOf(BookingStatus.class)));
    }
}
