package com.flighthotel.search.index;

/**
 * Elasticsearch cannot be reached or is overloaded. Searches answer 503 SEARCH_UNAVAILABLE; Kafka listeners keep
 * retrying the same event until it is back (see {@code SearchKafkaConfig}), so no update is lost.
 */
public class SearchIndexUnavailableException extends RuntimeException {

    public SearchIndexUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
