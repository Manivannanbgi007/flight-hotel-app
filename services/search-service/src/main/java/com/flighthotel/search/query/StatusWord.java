package com.flighthotel.search.query;

import static com.flighthotel.search.index.SearchCategory.BOOKINGS;
import static com.flighthotel.search.index.SearchCategory.PAYMENTS;
import static com.flighthotel.search.index.SearchCategory.REFUNDS;
import static com.flighthotel.search.index.SearchCategory.REVIEWS;
import static com.flighthotel.search.index.SearchCategory.TICKETS;
import static com.flighthotel.search.index.SearchCategory.USERS;

import java.util.List;
import java.util.Map;
import java.util.Set;

import com.flighthotel.search.index.SearchCategory;

/**
 * A status word in the query ("cancelled bookings", "open tickets") and the statuses it means in each category. The
 * booking sets match the tabs of My Trips (booking-service {@code BookingStatus.tab()}), so search and the trip list
 * agree on what "cancelled" or "upcoming" is.
 */
public enum StatusWord {
    PENDING("Pending", List.of("pending", "waiting", "awaiting", "unpaid"), Map.of(
            BOOKINGS, Set.of("INITIATED", "PENDING_PAYMENT", "PAYMENT_SUCCESS", "SUPPLIER_PENDING"),
            REFUNDS, Set.of("REQUESTED"),
            TICKETS, Set.of("OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "ESCALATED"),
            REVIEWS, Set.of("PENDING"),
            USERS, Set.of("PENDING_VERIFICATION"))),
    UPCOMING("Upcoming", List.of("upcoming", "future", "next"), Map.of(
            BOOKINGS, Set.of("CONFIRMED", "CANCELLATION_PENDING"))),
    CONFIRMED("Confirmed", List.of("confirmed"), Map.of(
            BOOKINGS, Set.of("CONFIRMED"))),
    COMPLETED("Completed", List.of("completed", "past", "finished"), Map.of(
            BOOKINGS, Set.of("COMPLETED"),
            REFUNDS, Set.of("COMPLETED"))),
    CANCELLED("Cancelled", List.of("cancelled", "canceled", "cancellation", "cancellations"), Map.of(
            BOOKINGS, Set.of("CANCELLED", "REFUND_PENDING", "REFUNDED", "FAILED", "EXPIRED"))),
    FAILED("Failed", List.of("failed", "unsuccessful", "declined"), Map.of(
            BOOKINGS, Set.of("FAILED"),
            PAYMENTS, Set.of("FAILED"),
            REFUNDS, Set.of("FAILED"))),
    SUCCESSFUL("Successful", List.of("successful", "succeeded", "paid", "captured"), Map.of(
            PAYMENTS, Set.of("SUCCEEDED"))),
    REFUNDED("Refunded", List.of("refunded"), Map.of(
            BOOKINGS, Set.of("REFUNDED"),
            REFUNDS, Set.of("COMPLETED"))),
    EXPIRED("Expired", List.of("expired"), Map.of(
            BOOKINGS, Set.of("EXPIRED"))),
    OPEN("Open", List.of("open", "unresolved"), Map.of(
            TICKETS, Set.of("OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "ESCALATED"))),
    RESOLVED("Resolved", List.of("resolved", "closed", "solved"), Map.of(
            TICKETS, Set.of("RESOLVED", "CLOSED"))),
    ESCALATED("Escalated", List.of("escalated"), Map.of(
            TICKETS, Set.of("ESCALATED"))),
    APPROVED("Approved", List.of("approved", "published"), Map.of(
            REVIEWS, Set.of("APPROVED"))),
    REJECTED("Rejected", List.of("rejected"), Map.of(
            REVIEWS, Set.of("REJECTED"))),
    ACTIVE("Active", List.of("active"), Map.of(
            USERS, Set.of("ACTIVE"))),
    DEACTIVATED("Deactivated", List.of("deactivated", "inactive", "disabled", "blocked"), Map.of(
            USERS, Set.of("DEACTIVATED")));

    private final String label;
    private final List<String> words;
    private final Map<SearchCategory, Set<String>> statuses;

    StatusWord(String label, List<String> words, Map<SearchCategory, Set<String>> statuses) {
        this.label = label;
        this.words = words;
        this.statuses = statuses;
    }

    public String label() {
        return label;
    }

    List<String> words() {
        return words;
    }

    /** The statuses this word means in the category; empty when the word means nothing there. */
    public Set<String> statusesIn(SearchCategory category) {
        return statuses.getOrDefault(category, Set.of());
    }

    public Set<SearchCategory> categories() {
        return statuses.keySet();
    }
}
