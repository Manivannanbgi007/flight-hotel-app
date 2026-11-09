package com.flighthotel.search.config;

import org.springframework.util.backoff.BackOff;

/** Lets tests in other packages reach the package-private retry rules of {@link SearchKafkaConfig}. */
public final class SearchKafkaConfigAccess {

    private SearchKafkaConfigAccess() {
    }

    public static boolean causedByUnavailableIndex(Throwable error) {
        return SearchKafkaConfig.causedByUnavailableIndex(error);
    }

    public static BackOff untilElasticsearchIsBack() {
        return SearchKafkaConfig.untilElasticsearchIsBack();
    }
}
