package com.flighthotel.assistant.blocks;

/**
 * A button under an answer. {@code route} is a {@link Route} key, never a path or URL. {@code hotel}: the name of the
 * manager's hotel for hotel pages (from a tool result), which the browser matches to the manager's own hotels.
 * {@code query}: a booking reference the tools returned, which the page opens with as its search word, or null.
 */
public record ChatAction(String route, String label, String icon, String hotel, String query) {

    public static ChatAction of(Route route, String hotel, String query) {
        return new ChatAction(route.name(), route.label(), route.icon(), hotel, query);
    }
}
