package com.flighthotel.search.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.listener.CommonErrorHandler;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.BackOff;
import org.springframework.util.backoff.ExponentialBackOff;

import com.flighthotel.search.index.SearchIndexUnavailableException;

/**
 * How failed events are retried. common-lib's error handler retries a few times and then sends the event to the
 * dead-letter topic ({@code <topic>.DLT}); that stays the rule for events that cannot be indexed (a bad document).
 * <p>
 * When Elasticsearch itself is down, sending events to the DLT would quietly lose updates. So for
 * {@link SearchIndexUnavailableException} the listener keeps retrying the same event (1 s, 2 s, 4 s ... at most 30 s
 * apart) until Elasticsearch answers again, then carries on where it stopped.
 */
@Configuration
public class SearchKafkaConfig {

    @Bean
    SmartInitializingSingleton retryWhileElasticsearchIsDown(ObjectProvider<CommonErrorHandler> errorHandler) {
        return () -> {
            if (errorHandler.getIfAvailable() instanceof DefaultErrorHandler handler) {
                handler.setBackOffFunction((record, ex) -> causedByUnavailableIndex(ex) ? untilElasticsearchIsBack() : null);
            }
        };
    }

    static boolean causedByUnavailableIndex(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof SearchIndexUnavailableException) {
                return true;
            }
        }
        return false;
    }

    static BackOff untilElasticsearchIsBack() {
        ExponentialBackOff backOff = new ExponentialBackOff(1_000, 2.0);
        backOff.setMaxInterval(30_000);
        backOff.setMaxAttempts(Integer.MAX_VALUE);
        return backOff;
    }
}
