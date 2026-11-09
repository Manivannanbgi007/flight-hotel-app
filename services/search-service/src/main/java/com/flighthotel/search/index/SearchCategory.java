package com.flighthotel.search.index;

import java.util.Locale;
import java.util.Optional;

/**
 * The kinds of things global search finds. All of them except {@link #HOTELS} live in the search service's own index
 * (field {@code category}); hotels are searched in hotel-service's {@code hotels} index.
 * <p>
 * The order here is the order of the category tabs in the results page.
 */
public enum SearchCategory {
    USERS,
    HOTELS,
    DESTINATIONS,
    BOOKINGS,
    PAYMENTS,
    REFUNDS,
    TICKETS,
    REVIEWS,
    PAGES;

    /** The document id in the index: one namespace per category, so ids of different kinds never clash. */
    public String docId(String entityId) {
        return name() + ":" + entityId;
    }

    /** {@code "bookings"} → BOOKINGS; empty for an unknown name. */
    public static Optional<SearchCategory> parse(String value) {
        if (value == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(valueOf(value.trim().toUpperCase(Locale.ROOT)));
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }
}
