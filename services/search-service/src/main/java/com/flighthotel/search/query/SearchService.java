package com.flighthotel.search.query;

import static com.flighthotel.search.index.SearchCategory.HOTELS;
import static com.flighthotel.search.index.SearchCategory.PAGES;

import java.io.IOException;
import java.io.StringReader;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.search.config.SearchProperties;
import com.flighthotel.search.index.SearchCategory;
import com.flighthotel.search.index.SearchIndex;
import com.flighthotel.search.index.SearchIndexUnavailableException;
import com.flighthotel.search.web.SearchDtos.CategoryCount;
import com.flighthotel.search.web.SearchDtos.ResultGroup;
import com.flighthotel.search.web.SearchDtos.SearchResponse;
import com.flighthotel.search.web.SearchDtos.SearchResult;
import com.flighthotel.search.web.SearchDtos.SuggestResponse;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.ElasticsearchException;
import co.elastic.clients.elasticsearch._types.aggregations.Aggregate;
import co.elastic.clients.elasticsearch._types.aggregations.StringTermsBucket;
import co.elastic.clients.elasticsearch.core.search.Hit;
import co.elastic.clients.json.JsonData;
import tools.jackson.databind.json.JsonMapper;

/**
 * Runs a search for one viewer:
 * <ol>
 *   <li>understand the words ({@link QueryUnderstanding});</li>
 *   <li>decide which categories to search: those the viewer may search ({@link AccessRules}), narrowed to the ones the
 *       words named;</li>
 *   <li>ask Elasticsearch: one request to the own index (all categories at once, each with its access filter) and one
 *       to hotel-service's {@code hotels} index;</li>
 *   <li>turn the documents into results with the right links ({@link ResultMapper}).</li>
 * </ol>
 */
@Service
public class SearchService {

    static final int SUGGESTIONS_PER_CATEGORY = 4;
    static final int RESULTS_PER_GROUP = 5;
    private static final Logger log = LoggerFactory.getLogger(SearchService.class);

    private final ElasticsearchClient elasticsearch;
    private final SearchIndex index;
    private final SearchProperties properties;
    private final JsonMapper json;

    public SearchService(ElasticsearchClient elasticsearch, SearchIndex index, SearchProperties properties,
            JsonMapper json) {
        this.elasticsearch = elasticsearch;
        this.index = index;
        this.properties = properties;
        this.json = json;
    }

    /** What to search: the understood query, the categories allowed and the categories searched. */
    record Plan(ParsedQuery query, List<SearchCategory> allowed, List<SearchCategory> targets, String interpretation) {
    }

    /** The dropdown under the search box: the best few of each category, best category first. */
    public SuggestResponse suggest(String query, Viewer viewer) {
        long start = System.nanoTime();
        Plan plan = plan(query, viewer);
        Groups groups = groups(plan, viewer, SUGGESTIONS_PER_CATEGORY);
        return new SuggestResponse(plan.query().raw(), millisSince(start), groups.nonEmpty(plan, viewer));
    }

    /** The results page: every category grouped ({@code category} null), or one category a page at a time. */
    public SearchResponse search(String query, SearchCategory category, int page, int size, Viewer viewer) {
        long start = System.nanoTime();
        Plan plan = plan(query, viewer);
        if (category != null && !plan.allowed().contains(category)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "You cannot search " + category.name().toLowerCase(Locale.ROOT) + ".");
        }
        if (category == null) {
            Groups groups = groups(plan, viewer, RESULTS_PER_GROUP);
            List<CategoryCount> counts = counts(plan, viewer, groups.counts);
            long total = counts.stream().mapToLong(CategoryCount::total).sum();
            return new SearchResponse(plan.query().raw(), millisSince(start), "ALL", plan.interpretation(), counts,
                    total, groups.nonEmpty(plan, viewer), null);
        }
        Map<SearchCategory, Long> found = new EnumMap<>(SearchCategory.class);
        List<SearchResult> pageItems = new ArrayList<>();
        List<SearchCategory> own = ownTargets(plan);
        boolean wanted = plan.targets().contains(category);
        if (!own.isEmpty()) {
            Map<String, Object> body = ownBody(plan, viewer, own);
            body.put("aggs", Map.of("categories", Map.of("terms", Map.of("field", "category", "size", 20))));
            boolean pageHere = wanted && category != HOTELS;
            body.put("post_filter", Map.of("term", Map.of("category", category.name())));
            body.put("from", pageHere ? page * size : 0);
            body.put("size", pageHere ? size : 0);
            var response = run(index.alias(), body, false);
            buckets(response.aggregations().get("categories")).forEach(bucket ->
                    found.put(SearchCategory.valueOf(bucket.key().stringValue()), bucket.docCount()));
            if (pageHere) {
                for (Hit<Map> hit : response.hits().hits()) {
                    pageItems.add(ResultMapper.own(category, source(hit.source()), hit.highlight(), viewer, plan.query()));
                }
            }
        }
        if (plan.targets().contains(HOTELS)) {
            boolean pageHere = category == HOTELS;
            Map<String, Object> body = hotelBody(plan, viewer);
            body.put("from", pageHere ? page * size : 0);
            body.put("size", pageHere ? size : 0);
            var response = run(properties.hotelsIndex(), body, true);
            found.put(HOTELS, response.hits().total() == null ? 0 : response.hits().total().value());
            if (pageHere) {
                for (Hit<Map> hit : response.hits().hits()) {
                    pageItems.add(ResultMapper.hotel(source(hit.source()), hit.highlight(), viewer));
                }
            }
        }
        long total = wanted ? found.getOrDefault(category, 0L) : 0;
        int totalPages = (int) Math.ceil(total / (double) size);
        return new SearchResponse(plan.query().raw(), millisSince(start), category.name(), plan.interpretation(),
                counts(plan, viewer, found), total, List.of(),
                new PageResponse<>(pageItems, page, size, total, totalPages));
    }

    // ----- planning -----

    Plan plan(String rawQuery, Viewer viewer) {
        ParsedQuery understood = QueryUnderstanding.parse(rawQuery);
        ParsedQuery query = understood;
        List<SearchCategory> allowed = AccessRules.categories(viewer);
        List<SearchCategory> targets = allowed;
        if (!understood.categories().isEmpty()) {
            List<SearchCategory> named = allowed.stream()
                    .filter(category -> category == PAGES || understood.categories().contains(category)).toList();
            if (named.stream().allMatch(category -> category == PAGES)) {
                // The words name something this viewer cannot search ("payments" for a hotel manager): search the
                // words as they were typed instead of turning them into filters.
                query = new ParsedQuery(query.raw(), query.raw(), query.pageText(), Set.of(), null, null, null,
                        query.flightIntent(), false);
            } else if (understood.browse()) {
                // Only filters ("my bookings", "cancelled reservations"): list just those records.
                targets = named;
            }
            // Otherwise there are words to match ("Refund not received"): every category is searched and the named
            // ones are shown first (see Groups), so a ticket about a refund is still found.
        }
        return new Plan(query, allowed, targets, interpretation(query, targets, viewer));
    }

    /** "Cancelled bookings", "Open support tickets", "Hotel managers": shown when words became filters. */
    static String interpretation(ParsedQuery query, List<SearchCategory> targets, Viewer viewer) {
        if (query.waitingForPayment()) {
            return "Bookings waiting for payment";
        }
        boolean filtered = query.status() != null || query.role() != null || (query.browse() && !query.categories().isEmpty());
        if (!filtered) {
            return null;
        }
        List<String> nouns = targets.stream()
                .filter(category -> category != PAGES)
                .filter(category -> query.categories().isEmpty() || query.categories().contains(category))
                .filter(category -> query.status() == null || !query.status().statusesIn(category).isEmpty())
                .map(category -> noun(category, query, viewer))
                .toList();
        if (nouns.isEmpty()) {
            return null;
        }
        String text = (query.status() != null ? query.status().label() + " " : "") + String.join(", ", nouns);
        return Character.toUpperCase(text.charAt(0)) + text.substring(1);
    }

    private static String noun(SearchCategory category, ParsedQuery query, Viewer viewer) {
        if (category == SearchCategory.USERS && query.role() != null) {
            return switch (query.role()) {
                case "CUSTOMER" -> "customers";
                case "HOTEL_MANAGER" -> "hotel managers";
                case "SUPPORT_AGENT" -> "support agents";
                default -> "administrators";
            };
        }
        if (category == SearchCategory.BOOKINGS && query.bookingType() != null) {
            return "HOTEL".equals(query.bookingType()) ? "hotel bookings" : "flight bookings";
        }
        return AccessRules.label(category, viewer).toLowerCase(Locale.ROOT).replace("my ", "");
    }

    // ----- grouped results (dropdown, "All" tab) -----

    /** Hits and counts per category, and the best score of each, for ordering the groups. */
    private record Groups(Map<SearchCategory, Long> counts, Map<SearchCategory, List<SearchResult>> items,
            Map<SearchCategory, Double> best) {

        /**
         * Only filters ("my bookings"): the named categories first, they are the answer. Words to match: the best match
         * first, the categories the words named ("hotel", "payments") counting double, so an exact page title still
         * beats a one-typo match in a named category.
         */
        List<ResultGroup> nonEmpty(Plan plan, Viewer viewer) {
            Set<SearchCategory> named = plan.query().categories();
            Comparator<SearchCategory> order = plan.query().browse()
                    ? Comparator.<SearchCategory, Boolean>comparing(category -> !named.contains(category))
                            .thenComparing(category -> -best.getOrDefault(category, 0.0))
                    : Comparator.comparing(category -> -best.getOrDefault(category, 0.0) * (named.contains(category) ? 2 : 1));
            return plan.targets().stream()
                    .filter(category -> !items.getOrDefault(category, List.of()).isEmpty())
                    .sorted(order.thenComparing(SearchCategory::ordinal))
                    .map(category -> new ResultGroup(category, AccessRules.label(category, viewer),
                            counts.getOrDefault(category, 0L), items.get(category)))
                    .toList();
        }
    }

    private Groups groups(Plan plan, Viewer viewer, int perCategory) {
        Map<SearchCategory, Long> counts = new EnumMap<>(SearchCategory.class);
        Map<SearchCategory, List<SearchResult>> items = new EnumMap<>(SearchCategory.class);
        Map<SearchCategory, Double> best = new EnumMap<>(SearchCategory.class);
        List<SearchCategory> own = ownTargets(plan);
        if (!own.isEmpty()) {
            Map<String, Object> top = new LinkedHashMap<>();
            top.put("size", perCategory);
            top.put("_source", Map.of("includes", SearchQueries.OWN_SOURCE));
            top.put("highlight", SearchQueries.ownHighlight());
            top.put("sort", SearchQueries.ownSort(plan.query()));
            Map<String, Object> body = ownBody(plan, viewer, own);
            body.put("size", 0);
            body.put("aggs", Map.of("categories", Map.of(
                    "terms", Map.of("field", "category", "size", 20),
                    "aggs", Map.of("top", Map.of("top_hits", top)))));
            var response = run(index.alias(), body, false);
            for (StringTermsBucket bucket : buckets(response.aggregations().get("categories"))) {
                SearchCategory category = SearchCategory.valueOf(bucket.key().stringValue());
                counts.put(category, bucket.docCount());
                List<SearchResult> results = new ArrayList<>();
                List<Hit<JsonData>> hits = bucket.aggregations().get("top").topHits().hits().hits();
                for (Hit<JsonData> hit : hits) {
                    results.add(ResultMapper.own(category, source(hit.source().to(Map.class)), hit.highlight(), viewer,
                            plan.query()));
                }
                items.put(category, results);
                best.put(category, hits.isEmpty() || hits.getFirst().score() == null ? 0.0 : hits.getFirst().score());
            }
        }
        if (plan.targets().contains(HOTELS)) {
            Map<String, Object> body = hotelBody(plan, viewer);
            body.put("size", perCategory);
            var response = run(properties.hotelsIndex(), body, true);
            counts.put(HOTELS, response.hits().total() == null ? 0 : response.hits().total().value());
            List<SearchResult> results = new ArrayList<>();
            for (Hit<Map> hit : response.hits().hits()) {
                results.add(ResultMapper.hotel(source(hit.source()), hit.highlight(), viewer));
            }
            items.put(HOTELS, results);
            best.put(HOTELS, response.hits().maxScore() == null ? 0.0 : response.hits().maxScore());
        }
        return new Groups(counts, items, best);
    }

    /** Every category the viewer may search, with how many results it has (0 when not searched or none). */
    private static List<CategoryCount> counts(Plan plan, Viewer viewer, Map<SearchCategory, Long> found) {
        return plan.allowed().stream()
                .map(category -> new CategoryCount(category, AccessRules.label(category, viewer),
                        plan.targets().contains(category) ? found.getOrDefault(category, 0L) : 0L))
                .toList();
    }

    // ----- request bodies -----

    private static List<SearchCategory> ownTargets(Plan plan) {
        return plan.targets().stream().filter(category -> category != HOTELS).toList();
    }

    private Map<String, Object> ownBody(Plan plan, Viewer viewer, List<SearchCategory> own) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timeout", properties.queryTimeout().toMillis() + "ms");
        body.put("track_total_hits", true);
        body.put("query", SearchQueries.ownQuery(plan.query(), viewer, own));
        body.put("_source", Map.of("includes", SearchQueries.OWN_SOURCE));
        body.put("highlight", SearchQueries.ownHighlight());
        body.put("sort", SearchQueries.ownSort(plan.query()));
        return body;
    }

    private Map<String, Object> hotelBody(Plan plan, Viewer viewer) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timeout", properties.queryTimeout().toMillis() + "ms");
        body.put("track_total_hits", true);
        body.put("query", SearchQueries.hotelQuery(plan.query(), AccessRules.managedHotelIds(viewer)));
        body.put("_source", Map.of("includes", SearchQueries.HOTEL_SOURCE));
        body.put("highlight", SearchQueries.hotelHighlight());
        body.put("sort", SearchQueries.hotelSort(plan.query()));
        return body;
    }

    // ----- Elasticsearch -----

    /**
     * Sends one search. Any Elasticsearch problem becomes 503 SEARCH_UNAVAILABLE for the user; the details only go to
     * the log (never Elasticsearch's own error text to the browser).
     */
    @SuppressWarnings({ "rawtypes" })
    private co.elastic.clients.elasticsearch.core.SearchResponse<Map> run(String target, Map<String, Object> body,
            boolean missingIndexIsEmpty) {
        String request = json.writeValueAsString(body);
        log.debug("Search {}: {}", target, request);
        try {
            if (!missingIndexIsEmpty) {
                index.ensureReady();
            }
            return elasticsearch.search(s -> s.index(target).ignoreUnavailable(missingIndexIsEmpty)
                    .withJson(new StringReader(request)), Map.class);
        } catch (IOException | SearchIndexUnavailableException ex) {
            log.warn("Search on {} failed: {}", target, ex.toString());
            throw unavailable();
        } catch (ElasticsearchException ex) {
            log.error("Elasticsearch refused the search on {}: {} (request {})", target, ex.getMessage(), request);
            throw unavailable();
        }
    }

    private static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "SEARCH_UNAVAILABLE",
                "Search is not available right now. Try again in a moment.");
    }

    private static List<StringTermsBucket> buckets(Aggregate aggregate) {
        return aggregate == null ? List.of() : aggregate.sterms().buckets().array();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> source(Object source) {
        return source instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private static long millisSince(long start) {
        return (System.nanoTime() - start) / 1_000_000;
    }
}
