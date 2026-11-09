package com.flighthotel.assistant.blocks;

import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import com.flighthotel.common.security.Roles;

/**
 * What a question is about, found from its words (no language model). Used for three things only: the log line "intent
 * classified", the buttons for pages the question names, and the tool-first rule: a question that asks for the user's
 * own live data must be answered from a tool, never from the model's memory.
 */
public final class Intent {

    /** Subjects the assistant knows pages for. */
    public enum Topic {
        TRIPS, PAYMENTS, NOTIFICATIONS, SUPPORT, PROFILE, PREFERENCES, SECURITY, PASSENGERS, REVIEWS, OFFERS,
        HOTEL_SEARCH, FLIGHT_SEARCH, CANCEL, ROOMS, INVENTORY, PHOTOS, RESERVATIONS, DASHBOARD, REPORTS, HOTEL_PROFILE,
        BOOKINGS, REFUNDS, USERS, TICKETS, ATTENTION
    }

    private static final Pattern HOW_TO = Pattern.compile(
            "\\b(how (do|can|to|should)|where (do|can|is)|steps to|i want to (update|change|edit|add|set|manage|open)"
                    + "|want to (update|change|edit)|update my|change my|edit my|reset my)\\b");
    private static final Pattern OWN = Pattern.compile("\\b(my|mine|me|i have|i've|do i|did i|have i|am i|our)\\b");
    private static final Pattern ASKING_STAFF = Pattern.compile(
            "\\b(show|list|how many|what|which|who|total|today|yesterday|tonight|this|last|number|any|find|search|give)\\b");

    private Intent() {
    }

    /** The subjects the question mentions. */
    public static Set<Topic> topics(String question) {
        String q = question == null ? "" : question.toLowerCase(Locale.ROOT);
        Set<Topic> found = EnumSet.noneOf(Topic.class);
        add(found, q, Topic.TRIPS, "trip", "itinerary", "upcoming", "my booking", "hotel booking", "flight booking",
                "my stay", "my flight");
        add(found, q, Topic.PAYMENTS, "payment", "paid", "invoice", "receipt", "transaction", "charged");
        add(found, q, Topic.REFUNDS, "refund");
        add(found, q, Topic.NOTIFICATIONS, "notification", "alert", "unread");
        add(found, q, Topic.SUPPORT, "support", "ticket", "complaint", "help request");
        add(found, q, Topic.PROFILE, "profile", "my name", "phone number", "personal detail", "my details");
        add(found, q, Topic.PREFERENCES, "preference", "language", "newsletter");
        add(found, q, Topic.SECURITY, "password", "security", "sessions", "two-factor", "log out everywhere");
        add(found, q, Topic.PASSENGERS, "passenger", "traveller", "traveler");
        add(found, q, Topic.REVIEWS, "review", "rating");
        add(found, q, Topic.OFFERS, "offer", "coupon", "discount");
        add(found, q, Topic.HOTEL_SEARCH, "find a hotel", "search hotel", "hotels in", "hotel in", "book a hotel");
        add(found, q, Topic.FLIGHT_SEARCH, "find a flight", "search flight", "flights from", "flights to", "book a flight");
        add(found, q, Topic.CANCEL, "cancel");
        add(found, q, Topic.ROOMS, "room type", "rooms", "rate plan", "room rate", "seasonal price");
        add(found, q, Topic.INVENTORY, "inventory", "stop-sell", "stop sell", "availability calendar", "block dates");
        add(found, q, Topic.PHOTOS, "photo", "image");
        add(found, q, Topic.RESERVATIONS, "reservation", "arrival", "departure", "check-in", "check in", "check-out",
                "check out", "guests");
        add(found, q, Topic.DASHBOARD, "dashboard", "occupancy", "revenue", "overview", "kpi", "performance");
        add(found, q, Topic.REPORTS, "report");
        add(found, q, Topic.HOTEL_PROFILE, "hotel profile", "hotel details", "hotel information");
        add(found, q, Topic.BOOKINGS, "booking", "pnr");
        add(found, q, Topic.USERS, "user account", "users");
        add(found, q, Topic.TICKETS, "ticket queue", "tickets");
        add(found, q, Topic.ATTENTION, "needs attention", "attention");
        return found;
    }

    /** A "how do I ...?" question: answered with steps and a button, not with account data. */
    public static boolean howTo(String question) {
        return question != null && HOW_TO.matcher(question.toLowerCase(Locale.ROOT)).find();
    }

    /**
     * Does this question ask for live data of the account (bookings, payments, reservations, figures)? Then a tool must
     * run before the assistant answers. Deliberately narrow: a question without a data subject, a how-to question and
     * "what is your refund policy" stay with the model.
     *
     * @param afterToolAnswer the previous answer used a tool, so a short follow-up ("only the cancelled ones") is a
     *                        question about the same data
     */
    public static boolean needsData(String role, String question, boolean afterToolAnswer) {
        if (question == null || howTo(question)) {
            return false;
        }
        String q = question.toLowerCase(Locale.ROOT);
        Set<Topic> topics = topics(question);
        boolean dataTopic = topics.stream().anyMatch(DATA_TOPICS::contains);
        if (!dataTopic) {
            return afterToolAnswer && q.length() <= 80 && FOLLOW_UP.matcher(q).find();
        }
        boolean cue = Roles.CUSTOMER.equals(role) ? OWN.matcher(q).find() : ASKING_STAFF.matcher(q).find();
        return cue || afterToolAnswer && FOLLOW_UP.matcher(q).find();
    }

    private static final Set<Topic> DATA_TOPICS = EnumSet.of(Topic.TRIPS, Topic.PAYMENTS, Topic.REFUNDS,
            Topic.NOTIFICATIONS, Topic.SUPPORT, Topic.RESERVATIONS, Topic.DASHBOARD, Topic.REPORTS, Topic.BOOKINGS,
            Topic.TICKETS);
    private static final Pattern FOLLOW_UP = Pattern.compile(
            "\\b(only|just|those|these|them|that one|the (first|second|last|cancelled|pending|failed|confirmed)|"
                    + "filter|which of|and the|what about)\\b");

    /** For logs: the topics as a short list, e.g. "TRIPS,PAYMENTS". */
    public static String label(Set<Topic> topics) {
        return topics.isEmpty() ? "NONE" : String.join(",", topics.stream().map(Enum::name).toList());
    }

    private static void add(Set<Topic> found, String q, Topic topic, String... words) {
        for (String word : List.of(words)) {
            if (q.contains(word)) {
                found.add(topic);
                return;
            }
        }
    }
}
