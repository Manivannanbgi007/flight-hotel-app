package com.flighthotel.hotel.messaging;

import java.util.UUID;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import com.flighthotel.events.hotel.HotelCatalogChanged;
import com.flighthotel.hotel.search.HotelIndexer;

/**
 * CQRS read side: every catalog change rebuilds the hotel's search document. Rebuilding from MySQL is idempotent, so
 * duplicates and replays are harmless (no inbox table needed). Failures are retried, then dead-lettered.
 */
@Component
public class HotelEventsListener {

    static final String CONSUMER = "hotel-service-search-indexer";

    private final HotelIndexer indexer;

    public HotelEventsListener(HotelIndexer indexer) {
        this.indexer = indexer;
    }

    @KafkaListener(id = CONSUMER, groupId = CONSUMER, topics = "hotel.events")
    public void onHotelEvent(ConsumerRecord<String, Object> record) {
        if (record.value() instanceof HotelCatalogChanged event) {
            indexer.reindex(UUID.fromString(event.getHotelId()));
        }
    }
}
