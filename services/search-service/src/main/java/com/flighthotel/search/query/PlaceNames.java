package com.flighthotel.search.query;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Cities with two names. People search with either ("Bangalore", even "Banglore"), while the data uses one
 * ("Bengaluru"), and fuzzy matching cannot bridge "Bangalore" and "Bengaluru". So the query is also run with the other
 * name: "Banglore hotels" is searched as "Banglore hotels" <i>and</i> "bengaluru hotels".
 */
final class PlaceNames {

    private static final List<List<String>> SAME_PLACE = List.of(
            List.of("bengaluru", "bangalore"),
            List.of("mumbai", "bombay"),
            List.of("chennai", "madras"),
            List.of("kolkata", "calcutta"),
            List.of("gurugram", "gurgaon"),
            List.of("thiruvananthapuram", "trivandrum"),
            List.of("puducherry", "pondicherry"),
            List.of("kochi", "cochin"),
            List.of("mysuru", "mysore"),
            List.of("varanasi", "benares", "banaras"),
            List.of("pune", "poona"),
            List.of("vadodara", "baroda"),
            List.of("visakhapatnam", "vizag"),
            List.of("prayagraj", "allahabad"),
            List.of("panaji", "panjim"));

    private PlaceNames() {
    }

    /** The text with its first known city name replaced by each other name; empty when it names no such city. */
    static List<String> alternatives(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        String[] words = text.split(" ");
        for (int i = 0; i < words.length; i++) {
            String word = words[i].toLowerCase(Locale.ROOT);
            for (List<String> names : SAME_PLACE) {
                String matched = names.stream()
                        .filter(name -> name.equals(word) || QueryUnderstanding.nearlyEqual(word, name))
                        .findFirst().orElse(null);
                if (matched != null) {
                    List<String> alternatives = new ArrayList<>();
                    for (String other : names) {
                        if (!other.equals(matched)) {
                            String[] copy = words.clone();
                            copy[i] = other;
                            alternatives.add(String.join(" ", copy));
                        }
                    }
                    return alternatives;
                }
            }
        }
        return List.of();
    }
}
