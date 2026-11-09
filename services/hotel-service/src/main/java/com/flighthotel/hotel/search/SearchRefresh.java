package com.flighthotel.hotel.search;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Rebuilds a hotel's search document right after the current transaction commits, for changes the person making
 * them expects to see in search at once (a moderator approving a review changes the guest rating).
 * <p>
 * This is only the fast path: the same change also writes {@code HotelCatalogChanged} to the outbox, and
 * {@code HotelEventsListener} rebuilds the document from it. So if Elasticsearch is down at that moment, the index is
 * still repaired later, and a failure here never fails the business operation.
 */
@Component
public class SearchRefresh {

    private static final Logger log = LoggerFactory.getLogger(SearchRefresh.class);

    private final HotelIndexer indexer;
    private final TransactionTemplate newReadOnlyTransaction;

    public SearchRefresh(HotelIndexer indexer, PlatformTransactionManager transactionManager) {
        this.indexer = indexer;
        this.newReadOnlyTransaction = new TransactionTemplate(transactionManager);
        // A NEW transaction: during afterCommit the finished transaction (and its persistence context, with the
        // hotel as it was loaded before the change) is still bound to the thread.
        this.newReadOnlyTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.newReadOnlyTransaction.setReadOnly(true);
    }

    /** After commit (or now, when there is no transaction). */
    public void afterCommit(UUID hotelId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            refreshNow(hotelId);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                refreshNow(hotelId);
            }
        });
    }

    private void refreshNow(UUID hotelId) {
        try {
            newReadOnlyTransaction.executeWithoutResult(status -> indexer.reindex(hotelId));
        } catch (RuntimeException ex) {
            log.warn("Search document not refreshed now, the catalog event will do it hotelId={} error={}", hotelId,
                    ex.toString());
        }
    }
}
