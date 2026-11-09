package com.flighthotel.search.sync;

import static com.flighthotel.search.index.SearchCategory.DESTINATIONS;

import java.io.IOException;
import java.io.StringReader;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicBoolean;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.flighthotel.search.config.SearchProperties;
import com.flighthotel.search.index.Fields;
import com.flighthotel.search.index.IndexWriter;
import com.flighthotel.search.index.SearchIndexUnavailableException;
import com.flighthotel.search.support.Format;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.ElasticsearchException;
import co.elastic.clients.elasticsearch._types.aggregations.StringTermsBucket;
import co.elastic.clients.elasticsearch.core.SearchResponse;

/**
 * Destinations (DESTINATIONS): the cities people travel to, built from two existing sources because cities have no
 * events of their own:
 * <ul>
 *   <li>the cities of the active hotels in hotel-service's {@code hotels} index (with how many hotels each has);</li>
 *   <li>flight-service's public airport list ({@code GET /api/airports}).</li>
 * </ul>
 * Rebuilt every {@code search.destinations-refresh} and soon after a hotel changes ({@link #requestRefresh()}).
 */
@Component
public class DestinationsIndexer {

    private static final Logger log = LoggerFactory.getLogger(DestinationsIndexer.class);
    private static final String HOTEL_CITIES = """
            {
              "size": 0,
              "aggs": {
                "cities": {
                  "terms": { "field": "city.exact", "size": 1000 },
                  "aggs": { "sample": { "top_hits": { "size": 1, "_source": { "includes": ["city", "state", "countryCode"] } } } }
                }
              }
            }""";

    private final ElasticsearchClient elasticsearch;
    private final IndexWriter writer;
    private final SearchProperties properties;
    private final RestClient flightService;
    private final AtomicBoolean refreshRequested = new AtomicBoolean(true);
    private volatile Instant lastBuilt = Instant.EPOCH;

    public DestinationsIndexer(ElasticsearchClient elasticsearch, IndexWriter writer, SearchProperties properties) {
        this.elasticsearch = elasticsearch;
        this.writer = writer;
        this.properties = properties;
        SimpleClientHttpRequestFactory timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(2));
        timeouts.setReadTimeout(Duration.ofSeconds(5));
        this.flightService = RestClient.builder().baseUrl(properties.flightServiceUrl()).requestFactory(timeouts).build();
    }

    /** A hotel opened, closed or moved: rebuild at the next run of the reference data job. */
    public void requestRefresh() {
        refreshRequested.set(true);
    }

    /** Rebuilds when asked to, or when the last build is older than {@code search.destinations-refresh}. */
    public void refreshIfDue() {
        boolean due = lastBuilt.plus(properties.destinationsRefresh()).isBefore(Instant.now());
        boolean requested = refreshRequested.getAndSet(false);
        if (requested || due) {
            try {
                rebuild();
            } catch (RuntimeException ex) {
                refreshRequested.set(true);
                log.warn("Destinations not rebuilt, will retry: {}", ex.toString());
            }
        }
    }

    public int rebuild() {
        Map<String, Destination> byCity = new TreeMap<>();
        for (Map<String, Object> hotelCity : hotelCities()) {
            String city = String.valueOf(hotelCity.get("city"));
            Destination destination = byCity.computeIfAbsent(key(city), k -> new Destination(city));
            destination.hotels = ((Number) hotelCity.get("hotels")).intValue();
            destination.state = (String) hotelCity.get("state");
            destination.countryCode = (String) hotelCity.get("countryCode");
        }
        for (Map<String, Object> airport : airports()) {
            String city = String.valueOf(airport.get("city"));
            Destination destination = byCity.computeIfAbsent(key(city), k -> new Destination(city));
            destination.airports.add(Format.map("code", airport.get("iataCode"), "name", airport.get("name")));
            if (destination.countryCode == null) {
                destination.countryCode = (String) airport.get("countryCode");
            }
        }
        List<Fields> documents = byCity.entrySet().stream().map(entry -> entry.getValue().document(entry.getKey()))
                .toList();
        writer.indexAll(DESTINATIONS, documents);
        writer.deleteAllExcept(DESTINATIONS, byCity.keySet());
        lastBuilt = Instant.now();
        log.info("Search destinations indexed: {}", documents.size());
        return documents.size();
    }

    /** City, state, country and hotel count of every city with an active hotel. Empty when the index is missing. */
    @SuppressWarnings({ "unchecked", "rawtypes" })
    List<Map<String, Object>> hotelCities() {
        try {
            SearchResponse<Map> response = elasticsearch.search(s -> s.index(properties.hotelsIndex())
                    .ignoreUnavailable(true).withJson(new StringReader(HOTEL_CITIES)), Map.class);
            if (response.aggregations() == null || !response.aggregations().containsKey("cities")) {
                return List.of();
            }
            List<Map<String, Object>> cities = new ArrayList<>();
            for (StringTermsBucket bucket : response.aggregations().get("cities").sterms().buckets().array()) {
                var hits = bucket.aggregations().get("sample").topHits().hits().hits();
                Map<String, Object> sample = hits.isEmpty() ? Map.of() : hits.getFirst().source().to(Map.class);
                Map<String, Object> city = Format.map("city", sample.getOrDefault("city", bucket.key().stringValue()),
                        "state", sample.get("state"), "countryCode", sample.get("countryCode"),
                        "hotels", bucket.docCount());
                cities.add(city);
            }
            return cities;
        } catch (IOException ex) {
            throw new SearchIndexUnavailableException("Elasticsearch is not reachable (hotel cities)", ex);
        } catch (ElasticsearchException ex) {
            throw new SearchIndexUnavailableException("Hotel cities could not be read", ex);
        }
    }

    /** flight-service's airports; empty (and logged) when flight-service does not answer. */
    public List<Map<String, Object>> airports() {
        try {
            List<Map<String, Object>> airports = flightService.get().uri("/api/airports").retrieve()
                    .body(new ParameterizedTypeReference<>() {
                    });
            return airports == null ? List.of() : airports;
        } catch (RestClientException ex) {
            // flight-service may still be starting: build without airports now and try again at the next run.
            log.warn("Airports not available for destinations, retrying in a minute: {}", ex.toString());
            requestRefresh();
            return List.of();
        }
    }

    private static String key(String city) {
        return city.strip().toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", "-");
    }

    /** One city while it is being put together. */
    private static final class Destination {
        final String city;
        String state;
        String countryCode;
        int hotels;
        final List<Map<String, Object>> airports = new ArrayList<>();

        Destination(String city) {
            this.city = city;
        }

        Fields document(String key) {
            List<Object> codes = airports.stream().map(airport -> airport.get("code")).toList();
            List<Object> names = airports.stream().map(airport -> airport.get("name")).toList();
            String country = Format.country(countryCode);
            return Fields.of(DESTINATIONS, key)
                    .put("title", city)
                    .put("subtitle", Format.join(state, country, hotels > 0 ? hotels + (hotels == 1 ? " hotel" : " hotels") : null,
                            codes.isEmpty() ? null : String.join(", ", codes.stream().map(String::valueOf).toList())))
                    .add("keywords", state, country, names)
                    .add("identifiers", codes)
                    .put("display", Format.map("city", city, "state", state, "countryCode", countryCode,
                            "hotels", hotels, "airports", airports));
        }
    }
}
