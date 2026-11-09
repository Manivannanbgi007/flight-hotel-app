package com.flighthotel.search;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Global search (docs/GLOBAL_SEARCH_IMPLEMENTATION.md).
 * <ul>
 *   <li><b>Write side</b> ({@code sync} package): Kafka listeners turn the other services' events into search documents
 *       in Elasticsearch. The other services stay the source of truth; this service never changes their data.</li>
 *   <li><b>Read side</b> ({@code query} package): {@code GET /api/search} and {@code /api/search/suggest} search those
 *       documents (and hotel-service's {@code hotels} index), only returning what the signed-in user may see.</li>
 * </ul>
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class SearchServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(SearchServiceApplication.class, args);
    }
}
