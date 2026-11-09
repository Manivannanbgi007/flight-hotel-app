package com.flighthotel.assistant.blocks;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.flighthotel.assistant.blocks.Intent.Topic;
import com.flighthotel.common.security.Roles;

/**
 * Chooses the buttons under an answer, and the how-to steps, from three things the server knows: the tools that ran (and
 * what they returned), the subjects the question names, and the user's role. Only {@link Route} keys are ever produced,
 * and only keys the role may be shown; hotel names come from tool results. The language model decides nothing here.
 */
public final class ActionPlanner {

    private static final int MAX_ACTIONS = 5;
    private static final int MAX_HOTELS = 3;

    private ActionPlanner() {
    }

    /** The buttons for this answer, most relevant first. */
    public static List<ChatAction> plan(String role, Set<String> roles, String question, List<ToolRun> runs) {
        Map<String, ChatAction> chosen = new LinkedHashMap<>();
        Set<Topic> topics = Intent.topics(question);
        // 1. What the tools looked at.
        for (ToolRun run : runs) {
            if (run.error() && !"NOT_FOUND".equals(run.errorCode())) {
                continue;
            }
            for (Route route : routesOf(role, run.tool())) {
                addAction(chosen, roles, route, hotelsOf(run), referenceOf(run, route));
            }
        }
        // 2. What the question names.
        for (Topic topic : topics) {
            Route route = routeOf(role, topic);
            if (route != null) {
                addAction(chosen, roles, route, route.hotelScoped() ? hotelsFromRuns(runs) : List.of(), null);
            }
        }
        // The same page for several hotels: the label names the hotel ("View Reservations: Sea Breeze Resort").
        Map<String, Long> perRoute = new LinkedHashMap<>();
        chosen.values().stream().filter(action -> action.hotel() != null)
                .forEach(action -> perRoute.merge(action.route(), 1L, Long::sum));
        List<ChatAction> actions = new ArrayList<>();
        for (ChatAction action : chosen.values()) {
            boolean several = action.hotel() != null && perRoute.getOrDefault(action.route(), 0L) > 1
                    && !action.label().contains(action.hotel());
            actions.add(several ? new ChatAction(action.route(), action.label() + ": " + action.hotel(), action.icon(),
                    action.hotel(), action.query()) : action);
        }
        return actions.size() > MAX_ACTIONS ? actions.subList(0, MAX_ACTIONS) : actions;
    }

    /** Steps for a "how do I...?" question about a page of the user's portal, or null. */
    public static ChatBlock steps(String role, String question) {
        if (!Intent.howTo(question)) {
            return null;
        }
        for (Topic topic : Intent.topics(question)) {
            ChatBlock block = guide(role, topic);
            if (block != null) {
                return block;
            }
        }
        return null;
    }

    // ------------------------------------------------------------ routes

    private static List<Route> routesOf(String role, String tool) {
        return switch (tool) {
            case "my_bookings", "my_trip_summary", "cancellation_quote" -> List.of(Route.MY_TRIPS);
            case "booking_details" -> switch (role) {
                case Roles.ADMIN -> List.of(Route.ADMIN_BOOKINGS);
                case Roles.SUPPORT_AGENT -> List.of(Route.SUPPORT_BOOKINGS);
                default -> List.of(Route.MY_TRIPS);
            };
            case "my_payments" -> List.of(Route.PAYMENTS);
            case "my_support_tickets" -> List.of(Route.SUPPORT);
            case "my_notifications" -> List.of(Route.NOTIFICATIONS);
            case "search_hotels", "hotel_details" -> List.of(Route.HOTEL_SEARCH);
            case "search_flights" -> List.of(Route.FLIGHT_SEARCH);
            case "current_offers" -> List.of(Route.OFFERS);
            case "admin_dashboard" -> List.of(Route.ADMIN_DASHBOARD);
            case "search_bookings" -> List.of(Route.ADMIN_BOOKINGS);
            case "search_payments" -> List.of(Route.ADMIN_PAYMENTS);
            case "search_refunds" -> List.of(Route.ADMIN_REFUNDS);
            case "run_report" -> List.of(Route.ADMIN_REPORTS);
            case "my_hotels" -> List.of(Route.HOTEL_HOME);
            case "hotel_dashboard" -> List.of(Route.HOTEL_DASHBOARD);
            case "hotel_arrivals_departures", "hotel_reservations" -> List.of(Route.HOTEL_RESERVATIONS);
            case "hotel_occupancy" -> List.of(Route.HOTEL_REPORTS, Route.HOTEL_DASHBOARD);
            case "ticket_summary", "ticket_queue", "ticket_metrics" ->
                    List.of(Roles.ADMIN.equals(role) ? Route.ADMIN_SUPPORT : Route.SUPPORT_TICKETS);
            case "find_bookings" -> List.of(Route.SUPPORT_BOOKINGS);
            default -> List.of();
        };
    }

    private static Route routeOf(String role, Topic topic) {
        return switch (role) {
            case Roles.ADMIN -> switch (topic) {
                case DASHBOARD -> Route.ADMIN_DASHBOARD;
                case PAYMENTS -> Route.ADMIN_PAYMENTS;
                case REFUNDS -> Route.ADMIN_REFUNDS;
                case BOOKINGS, TRIPS -> Route.ADMIN_BOOKINGS;
                case REPORTS -> Route.ADMIN_REPORTS;
                case SUPPORT, TICKETS -> Route.ADMIN_SUPPORT;
                case USERS -> Route.ADMIN_USERS;
                default -> null;
            };
            case Roles.HOTEL_MANAGER -> switch (topic) {
                case DASHBOARD -> Route.HOTEL_DASHBOARD;
                case RESERVATIONS, BOOKINGS -> Route.HOTEL_RESERVATIONS;
                case ROOMS -> Route.HOTEL_ROOMS;
                case INVENTORY -> Route.HOTEL_INVENTORY;
                case REVIEWS -> Route.HOTEL_REVIEWS;
                case REPORTS -> Route.HOTEL_REPORTS;
                case PHOTOS -> Route.HOTEL_PHOTOS;
                case HOTEL_PROFILE, PROFILE -> Route.HOTEL_PROFILE;
                default -> null;
            };
            case Roles.SUPPORT_AGENT -> switch (topic) {
                case TICKETS, SUPPORT -> Route.SUPPORT_TICKETS;
                case BOOKINGS -> Route.SUPPORT_BOOKINGS;
                case ATTENTION -> Route.SUPPORT_ATTENTION;
                default -> null;
            };
            default -> switch (topic) {
                case TRIPS, BOOKINGS, CANCEL -> Route.MY_TRIPS;
                case PAYMENTS, REFUNDS -> Route.PAYMENTS;
                case NOTIFICATIONS -> Route.NOTIFICATIONS;
                case SUPPORT -> Route.SUPPORT;
                case PROFILE -> Route.PROFILE;
                case PREFERENCES -> Route.PREFERENCES;
                case SECURITY -> Route.SECURITY;
                case PASSENGERS -> Route.PASSENGERS;
                case REVIEWS -> Route.MY_REVIEWS;
                case OFFERS -> Route.OFFERS;
                case HOTEL_SEARCH -> Route.HOTEL_SEARCH;
                case FLIGHT_SEARCH -> Route.FLIGHT_SEARCH;
                default -> null;
            };
        };
    }

    private static void addAction(Map<String, ChatAction> chosen, Set<String> roles, Route route, List<String> hotels,
            String query) {
        if (!route.allowedFor(roles)) {
            return;
        }
        if (route.hotelScoped()) {
            if (hotels.isEmpty()) {
                // No hotel named by a tool: the page picks the manager's only hotel, or the hotel list.
                chosen.putIfAbsent(route.name() + "|", ChatAction.of(route, null, null));
                return;
            }
            for (String hotel : hotels.stream().limit(MAX_HOTELS).toList()) {
                ChatAction action = ChatAction.of(route, hotel, null);
                chosen.putIfAbsent(route.name() + "|" + hotel, hotels.size() > 1
                        ? new ChatAction(action.route(), route.label() + ": " + hotel, action.icon(), hotel, null) : action);
            }
            return;
        }
        chosen.putIfAbsent(route.name() + "|" + (query == null ? "" : query), ChatAction.of(route, null, query));
    }

    /** The booking reference of a single-booking result, which My Trips accepts as its search word. */
    private static String referenceOf(ToolRun run, Route route) {
        if (run.error() || run.result() == null || route != Route.MY_TRIPS) {
            return null;
        }
        Object reference = run.result().get("reference");
        return reference instanceof String text && text.matches("[A-Z]{2}-[A-Z0-9]{8}") ? text : null;
    }

    /** Hotel names a tool named: {@code hotel}, {@code hotels[].hotel} or (my_hotels) {@code hotels[].name}. */
    @SuppressWarnings("unchecked")
    private static List<String> hotelsOf(ToolRun run) {
        Set<String> names = new LinkedHashSet<>();
        Map<String, Object> result = run.result();
        if (run.error() || result == null) {
            return List.of();
        }
        if (result.get("hotel") instanceof String name) {
            names.add(name);
        }
        if (result.get("hotels") instanceof List<?> list) {
            for (Object entry : list) {
                if (entry instanceof Map<?, ?> map) {
                    Object name = ((Map<String, Object>) map).get("hotel") != null ? ((Map<String, Object>) map).get("hotel")
                            : ((Map<String, Object>) map).get("name");
                    if (name instanceof String text) {
                        names.add(text);
                    }
                }
            }
        }
        return new ArrayList<>(names);
    }

    private static List<String> hotelsFromRuns(List<ToolRun> runs) {
        Set<String> names = new LinkedHashSet<>();
        runs.forEach(run -> names.addAll(hotelsOf(run)));
        return new ArrayList<>(names);
    }

    // ------------------------------------------------------------- guides

    /** How-to steps. They describe the app's real pages (names as in the menus); only where the page exists. */
    private static ChatBlock guide(String role, Topic topic) {
        if (Roles.HOTEL_MANAGER.equals(role)) {
            return switch (topic) {
                case ROOMS -> ChatBlock.steps("Manage rooms and rates", List.of(
                        "Open Rooms & rates for your hotel.",
                        "Choose Edit room type to change a room type, or Add room type for a new one.",
                        "Add or change rate plans and seasonal prices under the room type.",
                        "Save. Changes apply to the nights that are not booked yet."));
                case INVENTORY -> ChatBlock.steps("Change availability", List.of(
                        "Open the Inventory calendar for your hotel.",
                        "Choose a night in the calendar, or enter a first and last night under Change availability.",
                        "Set the rooms for sale, or switch stop-sell on or off.",
                        "Select Apply. Booked and held rooms are never taken away."));
                case PHOTOS -> ChatBlock.steps("Add or change photos", List.of(
                        "Open Photos for your hotel.",
                        "Drag JPEG or PNG files (up to 5 MB each) onto the upload area, or choose files.",
                        "Use Make cover to choose the photo shown in search results.",
                        "Delete a photo with Delete and confirm."));
                case HOTEL_PROFILE, PROFILE -> ChatBlock.steps("Update the hotel profile", List.of(
                        "Open Profile for your hotel.",
                        "Change the details you need.",
                        "Save the profile."));
                default -> null;
            };
        }
        if (!Roles.CUSTOMER.equals(role)) {
            return null;
        }
        return switch (topic) {
            case PROFILE -> ChatBlock.steps("Update your profile", List.of(
                    "Open My Profile.",
                    "Change your name, phone number or other details.",
                    "Save the changes."));
            case PREFERENCES -> ChatBlock.steps("Change your preferences", List.of(
                    "Open Preferences.",
                    "Choose the options you want.",
                    "Save the changes."));
            case SECURITY -> ChatBlock.steps("Change your password or secure your account", List.of(
                    "Open Security Settings.",
                    "Enter your current password and choose a new one to change it.",
                    "Use the log-out-everywhere option if you think someone else has your password."));
            case PASSENGERS -> ChatBlock.steps("Manage saved passengers", List.of(
                    "Open Passengers.",
                    "Add a passenger, or edit or remove a saved one.",
                    "Save. Saved passengers can be chosen when you book a flight."));
            case SUPPORT -> ChatBlock.steps("Contact support", List.of(
                    "Open Support.",
                    "Start a new ticket and choose a topic (you can link a booking).",
                    "Describe the problem and send it. Replies appear on the ticket and in your notifications."));
            case CANCEL -> ChatBlock.steps("Cancel a booking", List.of(
                    "Open My Trips and choose the booking.",
                    "Select Cancel. The page shows the fee and refund before you confirm.",
                    "Confirm to cancel. The assistant cannot cancel for you."));
            default -> null;
        };
    }
}
