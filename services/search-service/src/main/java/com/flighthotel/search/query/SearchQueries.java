package com.flighthotel.search.query;

import static com.flighthotel.search.index.SearchCategory.BOOKINGS;
import static com.flighthotel.search.index.SearchCategory.PAGES;
import static com.flighthotel.search.index.SearchCategory.USERS;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import com.flighthotel.search.index.SearchCategory;

/**
 * The Elasticsearch queries, written as plain maps that become the same JSON you would type in Kibana or curl (the
 * service logs them at DEBUG). Relevance comes from several "should" clauses; a record scores the boosts of every
 * clause it matches, so the order of importance is:
 * <ol>
 *   <li>exact identifier: booking reference, e-mail, ticket number, payment id (boost 50 / 40);</li>
 *   <li>exact name: the whole title equals the query (30);</li>
 *   <li>the words as a phrase in the title (15);</li>
 *   <li>normal keyword match of all the words (4);</li>
 *   <li>prefix match while typing: "Che" → Chennai (3, through edge n-grams);</li>
 *   <li>fuzzy match of all the words, one or two typos (1);</li>
 *   <li>words found only in a long description (0.5).</li>
 * </ol>
 * Fuzzy matching never applies to identifiers (a reference must match exactly), needs the first letter right
 * ({@code prefix_length 1}) and allows one typo in words of 5 to 8 letters and two from 9 letters ({@link #FUZZINESS}),
 * so "Chenai" finds Chennai but "reports" does not find "resort". Cities with two names ("Bangalore" / "Bengaluru")
 * are searched under both ({@link PlaceNames}).
 */
public final class SearchQueries {

    /** No typo below 5 letters, one up to 8 letters, two from 9 letters. */
    static final String FUZZINESS = "AUTO:5,9";

    /** Highlights come back between these two control characters and are turned into text segments. */
    public static final String MARK_START = "\u0001";
    public static final String MARK_END = "\u0002";

    /** What the results need from a stored document (identifiers and names stay inside Elasticsearch). */
    static final List<String> OWN_SOURCE = List.of("category", "entityId", "title", "subtitle", "description", "status",
            "type", "paymentStatus", "priority", "method", "roles", "amount", "currency", "date", "endDate", "createdAt",
            "ownerUserId", "hotelId", "bookingId", "reservationId", "reference", "perHotel", "display");
    static final List<String> HOTEL_SOURCE = List.of("id", "slug", "name", "city", "state", "countryCode", "starRating",
            "guestRating", "reviewCount", "propertyType");

    private SearchQueries() {
    }

    /**
     * The query for the search service's own index: one clause per category, each with that category's access filter
     * and the filters understood from the words, so a single request covers every category.
     */
    public static Map<String, Object> ownQuery(ParsedQuery query, Viewer viewer, List<SearchCategory> categories) {
        List<Object> perCategory = new ArrayList<>();
        for (SearchCategory category : categories) {
            List<Object> filters = new ArrayList<>();
            filters.add(AccessRules.filter(category, viewer));
            filters.addAll(understoodFilters(category, query));
            Map<String, Object> clause = new LinkedHashMap<>();
            clause.put("filter", filters);
            if (category == PAGES) {
                clause.put("must", List.of(textQuery(query.pageText(), query.pageText())));
            } else if (!query.browse()) {
                clause.put("must", List.of(textQuery(query.text(), query.raw())));
            }
            perCategory.add(Map.of("bool", clause));
        }
        return Map.of("bool", Map.of(
                "filter", List.of(Map.of("term", Map.of("complete", true))),
                "should", perCategory,
                "minimum_should_match", 1));
    }

    /** Words → records: the layered clauses described in the class comment, also with a city's other name. */
    static Map<String, Object> textQuery(String text, String raw) {
        return withPlaceNames(wordsQuery(text, raw), PlaceNames.alternatives(text).stream()
                .map(alternative -> wordsQuery(alternative, alternative)).toList());
    }

    private static Map<String, Object> wordsQuery(String text, String raw) {
        List<String> exactValues = exactValues(text, raw);
        List<Object> should = new ArrayList<>();
        should.add(Map.of("terms", Map.of("identifiers", exactValues, "boost", 50)));
        should.add(Map.of("terms", Map.of("extraIdentifiers", exactValues, "boost", 40)));
        should.add(Map.of("terms", Map.of("title.exact", exactValues, "boost", 30)));
        should.add(Map.of("match_phrase", Map.of("title", Map.of("query", text, "boost", 15))));
        should.add(multiMatch(text, "cross_fields", 4,
                List.of("title^4", "names^3", "keywords^3", "details^2", "subtitle^2")));
        should.add(multiMatch(text, "cross_fields", 3,
                List.of("title.prefix^6", "names.prefix^4", "keywords.prefix^3", "details.prefix^2", "subtitle.prefix^2")));
        Map<String, Object> fuzzy = new LinkedHashMap<>(multiMatchBody(text, "best_fields", 1,
                List.of("title^2", "names^2", "keywords", "details")));
        fuzzy.put("fuzziness", FUZZINESS);
        fuzzy.put("prefix_length", 1);
        fuzzy.put("max_expansions", 50);
        should.add(Map.of("multi_match", fuzzy));
        should.add(Map.of("match", Map.of("description", Map.of("query", text, "operator", "and", "boost", 0.5))));
        return Map.of("bool", Map.of("should", should, "minimum_should_match", 1));
    }

    /** hotel-service's {@code hotels} index has other field names (name, city, state, address) but the same idea. */
    public static Map<String, Object> hotelQuery(ParsedQuery query, List<String> onlyHotelIds) {
        List<Object> filter = new ArrayList<>();
        if (onlyHotelIds != null) {
            filter.add(Map.of("terms", Map.of("id", onlyHotelIds)));
        }
        Map<String, Object> bool = new LinkedHashMap<>();
        bool.put("filter", filter);
        if (!query.browse()) {
            bool.put("must", List.of(withPlaceNames(hotelWords(query.text(), query.raw()),
                    PlaceNames.alternatives(query.text()).stream()
                            .map(alternative -> hotelWords(alternative, alternative)).toList())));
        }
        return Map.of("bool", bool);
    }

    private static Map<String, Object> hotelWords(String text, String raw) {
        List<String> exactValues = exactValues(text, raw);
        List<Object> should = new ArrayList<>();
        should.add(Map.of("terms", Map.of("name.exact", exactValues, "boost", 30)));
        should.add(Map.of("terms", Map.of("city.exact", exactValues, "boost", 12)));
        should.add(Map.of("match_phrase", Map.of("name", Map.of("query", text, "boost", 15))));
        should.add(multiMatch(text, "cross_fields", 4, List.of("name^4", "city^3", "state^2", "address")));
        should.add(multiMatch(text, "bool_prefix", 3, List.of("name^3", "city^2", "state", "address")));
        Map<String, Object> fuzzy = new LinkedHashMap<>(multiMatchBody(text, "best_fields", 1,
                List.of("name^2", "city^2")));
        fuzzy.put("fuzziness", FUZZINESS);
        fuzzy.put("prefix_length", 1);
        fuzzy.put("max_expansions", 50);
        should.add(Map.of("multi_match", fuzzy));
        return Map.of("bool", Map.of("should", should, "minimum_should_match", 1));
    }

    /** The query, or any of the query and its alternatives (a city's other name). */
    private static Map<String, Object> withPlaceNames(Map<String, Object> query, List<Map<String, Object>> alternatives) {
        if (alternatives.isEmpty()) {
            return query;
        }
        List<Object> any = new ArrayList<>();
        any.add(query);
        any.addAll(alternatives);
        return Map.of("bool", Map.of("should", any, "minimum_should_match", 1));
    }

    /** Filters from the understood words: "cancelled" → those statuses, "hotel" → hotel bookings, "upcoming" → future. */
    static List<Object> understoodFilters(SearchCategory category, ParsedQuery query) {
        List<Object> filters = new ArrayList<>();
        if (category == PAGES) {
            return filters;
        }
        if (category == BOOKINGS && query.bookingType() != null) {
            filters.add(Map.of("term", Map.of("type", query.bookingType())));
        }
        if (category == BOOKINGS && query.waitingForPayment()) {
            filters.add(Map.of("terms", Map.of("status", List.of("PENDING_PAYMENT"))));
        } else if (query.status() != null) {
            Set<String> statuses = query.status().statusesIn(category);
            // A status word that means nothing for this category ("cancelled" users) excludes the category.
            filters.add(statuses.isEmpty() ? Map.of("match_none", Map.of())
                    : Map.of("terms", Map.of("status", List.copyOf(statuses))));
            if (category == BOOKINGS && query.status() == StatusWord.UPCOMING) {
                filters.add(Map.of("range", Map.of("date", Map.of("gte", "now/d"))));
            }
        }
        if (category == USERS && query.role() != null) {
            filters.add(Map.of("term", Map.of("roles", query.role())));
        }
        return filters;
    }

    /** Highlighting of the own index: whole short fields, one fragment of the long description. */
    public static Map<String, Object> ownHighlight() {
        Map<String, Object> whole = Map.of("number_of_fragments", 0);
        Map<String, Object> fields = new LinkedHashMap<>();
        for (String field : List.of("title", "title.prefix", "subtitle", "subtitle.prefix", "names", "names.prefix",
                "details", "details.prefix")) {
            fields.put(field, whole);
        }
        fields.put("description", Map.of("fragment_size", 160, "number_of_fragments", 1));
        return highlight(fields);
    }

    public static Map<String, Object> hotelHighlight() {
        Map<String, Object> whole = Map.of("number_of_fragments", 0);
        return highlight(Map.of("name", whole, "city", whole));
    }

    /** Browsing (no words): newest first, or soonest first for upcoming trips. Searching: best match first. */
    public static List<Object> ownSort(ParsedQuery query) {
        if (query.browse() && query.status() == StatusWord.UPCOMING) {
            return List.of(Map.of("date", Map.of("order", "asc", "unmapped_type", "date")));
        }
        return List.of("_score", Map.of("createdAt", Map.of("order", "desc", "unmapped_type", "date")));
    }

    public static List<Object> hotelSort(ParsedQuery query) {
        return query.browse()
                ? List.of(Map.of("guestRating", Map.of("order", "desc", "unmapped_type", "float")), "_score")
                : List.of("_score");
    }

    /**
     * The fields go in Elasticsearch's array form ({@code [{"title": {...}}, {"subtitle": {...}}]}): the Java client
     * reads the request that way, and the order is kept.
     */
    private static Map<String, Object> highlight(Map<String, Object> fields) {
        List<Map<String, Object>> ordered = fields.entrySet().stream()
                .map(entry -> Map.of(entry.getKey(), entry.getValue())).toList();
        return Map.of("pre_tags", List.of(MARK_START), "post_tags", List.of(MARK_END), "require_field_match", true,
                "fields", ordered);
    }

    private static Map<String, Object> multiMatch(String text, String type, double boost, List<String> fields) {
        return Map.of("multi_match", multiMatchBody(text, type, boost, fields));
    }

    private static Map<String, Object> multiMatchBody(String text, String type, double boost, List<String> fields) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("query", text);
        body.put("type", type);
        body.put("operator", "and");
        body.put("fields", fields);
        body.put("boost", boost);
        return body;
    }

    /** The values an identifier may equal: the whole query and the words left after understanding it. */
    private static List<String> exactValues(String text, String raw) {
        Set<String> values = new LinkedHashSet<>();
        values.add(raw.toLowerCase(Locale.ROOT));
        values.add(text.toLowerCase(Locale.ROOT));
        values.remove("");
        return List.copyOf(values);
    }
}
