package com.flighthotel.search.sync;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Builds the pages and destinations at start-up and then checks every minute whether they need a rebuild. Pages and
 * destinations come from files and other indexes, not from events, so they are refreshed this way.
 * Off in tests ({@code search.jobs.enabled=false}); tests call the indexers directly.
 */
@Component
@ConditionalOnProperty(name = "search.jobs.enabled", havingValue = "true", matchIfMissing = true)
public class ReferenceDataJob {

    private static final Logger log = LoggerFactory.getLogger(ReferenceDataJob.class);

    private final PagesIndexer pages;
    private final DestinationsIndexer destinations;

    public ReferenceDataJob(PagesIndexer pages, DestinationsIndexer destinations) {
        this.pages = pages;
        this.destinations = destinations;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStart() {
        run();
    }

    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    public void run() {
        try {
            pages.rebuildIfNeeded();
        } catch (RuntimeException ex) {
            log.warn("Search pages not indexed yet, will retry: {}", ex.toString());
        }
        destinations.refreshIfDue();
    }
}
