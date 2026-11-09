package com.flighthotel.search.sync;

import java.io.IOException;
import java.io.StringReader;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.listener.AbstractConsumerSeekAware;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

import com.flighthotel.search.config.SearchProperties;
import com.flighthotel.search.index.SearchIndex;
import com.flighthotel.search.index.SearchIndexUnavailableException;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.ElasticsearchException;
import co.elastic.clients.elasticsearch.core.SearchResponse;

/**
 * Admin tools for the index (recovery, docs/GLOBAL_SEARCH_IMPLEMENTATION.md §12):
 * <ul>
 *   <li>{@link #status()}: documents per category, so a gap is visible;</li>
 *   <li>{@link #replay()}: every listener goes back to the start of its topic and applies the retained events again
 *       (Kafka keeps them 7 days). Writes are idempotent, so this only fills what is missing or outdated. Pages and
 *       destinations are rebuilt too.</li>
 * </ul>
 */
@Service
@PreAuthorize("hasRole('ADMIN')")
public class IndexMaintenance {

    private static final Logger log = LoggerFactory.getLogger(IndexMaintenance.class);
    private static final String COUNT_BY_CATEGORY = """
            { "size": 0, "aggs": { "categories": { "terms": { "field": "category", "size": 20 } } } }""";

    private final ElasticsearchClient elasticsearch;
    private final SearchIndex index;
    private final SearchProperties properties;
    private final List<AbstractConsumerSeekAware> listeners;
    private final PagesIndexer pages;
    private final DestinationsIndexer destinations;

    public IndexMaintenance(ElasticsearchClient elasticsearch, SearchIndex index, SearchProperties properties,
            List<AbstractConsumerSeekAware> listeners, PagesIndexer pages, DestinationsIndexer destinations) {
        this.elasticsearch = elasticsearch;
        this.index = index;
        this.properties = properties;
        this.listeners = listeners;
        this.pages = pages;
        this.destinations = destinations;
    }

    public record IndexStatus(String alias, String index, int mappingVersion, Map<String, Long> documents,
            long hotelsInHotelServiceIndex) {
    }

    @SuppressWarnings("rawtypes")
    public IndexStatus status() {
        try {
            index.ensureReady();
            SearchResponse<Map> own = elasticsearch.search(s -> s.index(index.alias())
                    .withJson(new StringReader(COUNT_BY_CATEGORY)), Map.class);
            Map<String, Long> documents = new LinkedHashMap<>();
            own.aggregations().get("categories").sterms().buckets().array()
                    .forEach(bucket -> documents.put(bucket.key().stringValue(), bucket.docCount()));
            SearchResponse<Map> hotels = elasticsearch.search(s -> s.index(properties.hotelsIndex())
                    .ignoreUnavailable(true).size(0).trackTotalHits(t -> t.enabled(true)), Map.class);
            long hotelCount = hotels.hits().total() == null ? 0 : hotels.hits().total().value();
            return new IndexStatus(index.alias(), index.currentIndexName(), SearchIndex.MAPPING_VERSION, documents,
                    hotelCount);
        } catch (IOException | ElasticsearchException ex) {
            throw new SearchIndexUnavailableException("Index status not available", ex);
        }
    }

    /** Starts the replay; the listeners catch up in the background. */
    public int replay() {
        listeners.forEach(AbstractConsumerSeekAware::seekToBeginning);
        pages.rebuild();
        destinations.requestRefresh();
        log.info("Search index replay started for {} listeners", listeners.size());
        return listeners.size();
    }
}
