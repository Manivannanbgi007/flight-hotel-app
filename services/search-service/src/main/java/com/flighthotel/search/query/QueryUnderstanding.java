package com.flighthotel.search.query;

import static com.flighthotel.search.index.SearchCategory.BOOKINGS;
import static com.flighthotel.search.index.SearchCategory.DESTINATIONS;
import static com.flighthotel.search.index.SearchCategory.HOTELS;
import static com.flighthotel.search.index.SearchCategory.PAYMENTS;
import static com.flighthotel.search.index.SearchCategory.REFUNDS;
import static com.flighthotel.search.index.SearchCategory.REVIEWS;
import static com.flighthotel.search.index.SearchCategory.TICKETS;
import static com.flighthotel.search.index.SearchCategory.USERS;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import com.flighthotel.search.index.SearchCategory;

/**
 * Reads the words of a query the way a person means them, with a small fixed vocabulary (no AI):
 * <ul>
 *   <li>Kinds of record: "bookings", "trips", "payments", "refunds", "tickets", "reviews", "customers",
 *       "hotel managers", "destinations". They limit the search to those categories.</li>
 *   <li>"hotel" / "flight": hotels, destinations, and bookings of that type.</li>
 *   <li>Status words ({@link StatusWord}): "cancelled", "upcoming", "pending", "open" ... become filters.</li>
 *   <li>Small words ("my", "in", "to", "the" ...) are dropped.</li>
 * </ul>
 * The vocabulary tolerates one typo in longer words ("Paymnt", "Reservaton", "Custmer", "Hotle"). Whatever is left
 * ("Chennai", "BK-7Q2X", "John Smith") is matched against the records by Elasticsearch. Examples:
 * <pre>
 * "Hotels in Chennai"      → hotels, destinations, hotel bookings, reviews; words "Chennai"
 * "Flights to Mumbai"      → destinations (opening the flight search), flight bookings; words "Mumbai"
 * "My cancelled reservations" → bookings with a cancelled status, listed newest first
 * "pending payments"       → bookings waiting for payment
 * </pre>
 */
public final class QueryUnderstanding {

    /** Words that never help to find a record. */
    static final Set<String> SMALL_WORDS = Set.of("my", "me", "mine", "our", "in", "at", "to", "for", "of", "the", "a",
            "an", "from", "with", "near", "on", "and", "or", "show", "find", "list", "all", "search", "please", "view");

    private enum Kind { HOTEL, FLIGHT, ENTITY }

    /** A word naming a kind of record. */
    private record Hint(Kind kind, Set<SearchCategory> categories, String role) {
    }

    private static final Map<String, Hint> HINTS = Map.ofEntries(
            Map.entry("hotel", new Hint(Kind.HOTEL, EnumSet.of(HOTELS, DESTINATIONS, BOOKINGS, REVIEWS), null)),
            Map.entry("hotels", new Hint(Kind.HOTEL, EnumSet.of(HOTELS, DESTINATIONS, BOOKINGS, REVIEWS), null)),
            Map.entry("flight", new Hint(Kind.FLIGHT, EnumSet.of(DESTINATIONS, BOOKINGS), null)),
            Map.entry("flights", new Hint(Kind.FLIGHT, EnumSet.of(DESTINATIONS, BOOKINGS), null)),
            entity("booking", BOOKINGS), entity("bookings", BOOKINGS), entity("trip", BOOKINGS),
            entity("trips", BOOKINGS), entity("reservation", BOOKINGS), entity("reservations", BOOKINGS),
            entity("itinerary", BOOKINGS),
            entity("payment", PAYMENTS), entity("payments", PAYMENTS), entity("transaction", PAYMENTS),
            entity("transactions", PAYMENTS), entity("invoice", PAYMENTS), entity("invoices", PAYMENTS),
            entity("receipt", PAYMENTS), entity("receipts", PAYMENTS),
            entity("refund", REFUNDS), entity("refunds", REFUNDS),
            entity("ticket", TICKETS), entity("tickets", TICKETS), entity("complaint", TICKETS),
            entity("complaints", TICKETS),
            entity("review", REVIEWS), entity("reviews", REVIEWS), entity("rating", REVIEWS),
            entity("ratings", REVIEWS),
            entity("destination", DESTINATIONS), entity("destinations", DESTINATIONS), entity("city", DESTINATIONS),
            entity("cities", DESTINATIONS),
            Map.entry("customer", new Hint(Kind.ENTITY, EnumSet.of(USERS), "CUSTOMER")),
            Map.entry("customers", new Hint(Kind.ENTITY, EnumSet.of(USERS), "CUSTOMER")),
            Map.entry("user", new Hint(Kind.ENTITY, EnumSet.of(USERS), null)),
            Map.entry("users", new Hint(Kind.ENTITY, EnumSet.of(USERS), null)),
            Map.entry("manager", new Hint(Kind.ENTITY, EnumSet.of(USERS), "HOTEL_MANAGER")),
            Map.entry("managers", new Hint(Kind.ENTITY, EnumSet.of(USERS), "HOTEL_MANAGER")),
            Map.entry("agent", new Hint(Kind.ENTITY, EnumSet.of(USERS), "SUPPORT_AGENT")),
            Map.entry("agents", new Hint(Kind.ENTITY, EnumSet.of(USERS), "SUPPORT_AGENT")),
            Map.entry("admin", new Hint(Kind.ENTITY, EnumSet.of(USERS), "ADMIN")),
            Map.entry("admins", new Hint(Kind.ENTITY, EnumSet.of(USERS), "ADMIN")),
            Map.entry("administrator", new Hint(Kind.ENTITY, EnumSet.of(USERS), "ADMIN")),
            Map.entry("administrators", new Hint(Kind.ENTITY, EnumSet.of(USERS), "ADMIN")));

    private QueryUnderstanding() {
    }

    private static Map.Entry<String, Hint> entity(String word, SearchCategory category) {
        return Map.entry(word, new Hint(Kind.ENTITY, EnumSet.of(category), null));
    }

    public static ParsedQuery parse(String query) {
        String raw = query == null ? "" : query.strip().replaceAll("\\s+", " ");
        String[] tokens = raw.isEmpty() ? new String[0] : raw.split(" ");

        Set<SearchCategory> entityCategories = EnumSet.noneOf(SearchCategory.class);
        Set<SearchCategory> typeCategories = EnumSet.noneOf(SearchCategory.class);
        String bookingType = null;
        String role = null;
        StatusWord status = null;
        boolean flightIntent = false;
        List<String> words = new ArrayList<>();
        List<String> pageWords = new ArrayList<>();

        for (int i = 0; i < tokens.length; i++) {
            String word = clean(tokens[i]);
            String next = i + 1 < tokens.length ? clean(tokens[i + 1]) : "";
            if (!SMALL_WORDS.contains(word)) {
                pageWords.add(tokens[i]);
            }
            // Two-word names first: "hotel managers" are people, not hotels.
            if (isWord(word, "hotel") && (isWord(next, "manager") || isWord(next, "managers"))) {
                entityCategories.add(USERS);
                role = "HOTEL_MANAGER";
                pageWords.add(tokens[i + 1]);
                i++;
                continue;
            }
            if (isWord(word, "support") && (isWord(next, "agent") || isWord(next, "agents"))) {
                entityCategories.add(USERS);
                role = "SUPPORT_AGENT";
                pageWords.add(tokens[i + 1]);
                i++;
                continue;
            }
            if (isWord(word, "support") && (isWord(next, "ticket") || isWord(next, "tickets"))) {
                entityCategories.add(TICKETS);
                pageWords.add(tokens[i + 1]);
                i++;
                continue;
            }
            if (SMALL_WORDS.contains(word)) {
                continue;
            }
            Hint hint = hint(word);
            if (hint != null) {
                switch (hint.kind()) {
                    case HOTEL -> {
                        typeCategories.addAll(hint.categories());
                        bookingType = "HOTEL";
                    }
                    case FLIGHT -> {
                        typeCategories.addAll(hint.categories());
                        bookingType = "FLIGHT";
                        flightIntent = true;
                    }
                    case ENTITY -> {
                        entityCategories.addAll(hint.categories());
                        if (hint.role() != null) {
                            role = hint.role();
                        }
                    }
                }
                continue;
            }
            StatusWord statusWord = statusWord(word);
            if (statusWord != null) {
                status = statusWord;
                continue;
            }
            words.add(tokens[i]);
        }

        // "hotel bookings": the kind (bookings) decides; "hotel" only narrows it to hotel bookings.
        Set<SearchCategory> categories = entityCategories.isEmpty() ? typeCategories : entityCategories;
        if (entityCategories.isEmpty() && !typeCategories.isEmpty() && words.isEmpty()) {
            // "my hotels" or "flights" alone: list the hotels, or the flight bookings, not every related record.
            categories = "HOTEL".equals(bookingType) && status == null ? EnumSet.of(HOTELS) : EnumSet.of(BOOKINGS);
        }
        boolean waitingForPayment = false;
        if (status == StatusWord.PENDING && categories.equals(EnumSet.of(PAYMENTS))) {
            // A payment is only stored once it succeeded or failed: "pending payments" are bookings waiting for one.
            categories = EnumSet.of(BOOKINGS);
            waitingForPayment = true;
        }
        if (categories.isEmpty() && status != null) {
            categories = EnumSet.copyOf(status.categories());
        }
        String text = String.join(" ", words);
        String pageText = pageWords.isEmpty() ? raw : String.join(" ", pageWords);
        if (text.isEmpty() && categories.isEmpty() && role == null) {
            // Nothing but small words ("my"): search them as they are.
            text = raw;
        }
        return new ParsedQuery(raw, text, pageText, categories, bookingType, status, role, flightIntent,
                waitingForPayment);
    }

    private static Hint hint(String word) {
        Hint exact = HINTS.get(word);
        if (exact != null) {
            return exact;
        }
        return HINTS.entrySet().stream().filter(entry -> nearlyEqual(word, entry.getKey())).map(Map.Entry::getValue)
                .findFirst().orElse(null);
    }

    private static StatusWord statusWord(String word) {
        for (StatusWord status : StatusWord.values()) {
            for (String candidate : status.words()) {
                if (candidate.equals(word) || nearlyEqual(word, candidate)) {
                    return status;
                }
            }
        }
        return null;
    }

    private static boolean isWord(String word, String expected) {
        return word.equals(expected) || nearlyEqual(word, expected);
    }

    /**
     * One typo in words of 5 to 7 letters, two in longer words; short words must be exact (so "star" is not taken
     * for "stay", nor "trim" for "trip").
     */
    static boolean nearlyEqual(String word, String expected) {
        if (word.length() < 5 || expected.length() < 5) {
            return false;
        }
        int allowed = expected.length() >= 8 ? 2 : 1;
        return Math.abs(word.length() - expected.length()) <= allowed && distance(word, expected) <= allowed;
    }

    /** Edit distance where swapping two neighbouring letters counts as one typo ("hotle" → "hotel"). */
    static int distance(String a, String b) {
        int[][] d = new int[a.length() + 1][b.length() + 1];
        for (int i = 0; i <= a.length(); i++) {
            d[i][0] = i;
        }
        for (int j = 0; j <= b.length(); j++) {
            d[0][j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                d[i][j] = Math.min(Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1), d[i - 1][j - 1] + cost);
                if (i > 1 && j > 1 && a.charAt(i - 1) == b.charAt(j - 2) && a.charAt(i - 2) == b.charAt(j - 1)) {
                    d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
                }
            }
        }
        return d[a.length()][b.length()];
    }

    private static String clean(String token) {
        return token.toLowerCase(Locale.ROOT).replaceAll("^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$", "");
    }
}
