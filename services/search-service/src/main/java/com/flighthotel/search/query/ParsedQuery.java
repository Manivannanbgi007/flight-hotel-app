package com.flighthotel.search.query;

import java.util.Set;

import com.flighthotel.search.index.SearchCategory;

/**
 * What the search box text was understood as (see {@link QueryUnderstanding}).
 *
 * @param raw               the query as typed (trimmed, single spaces)
 * @param text              the words to match in records, without the words that were understood as filters
 * @param pageText          the words to match in page names (only small words like "my" removed)
 * @param categories        the kinds of record named in the query ("bookings", "payments"); empty = all
 * @param bookingType       HOTEL or FLIGHT when the query said "hotel" or "flight"
 * @param status            a status word ("cancelled", "upcoming"), or null
 * @param role              for users: the role named ("hotel managers" → HOTEL_MANAGER), or null
 * @param flightIntent      the query is about flights ("Flights to Mumbai"): destinations open the flight search
 * @param waitingForPayment "pending payments": bookings that are waiting for payment
 */
public record ParsedQuery(String raw, String text, String pageText, Set<SearchCategory> categories, String bookingType,
        StatusWord status, String role, boolean flightIntent, boolean waitingForPayment) {

    /**
     * No words left to match, only filters ("my bookings", "cancelled reservations"): list the matching records,
     * newest first, instead of searching for words.
     */
    public boolean browse() {
        return text.isEmpty();
    }
}
