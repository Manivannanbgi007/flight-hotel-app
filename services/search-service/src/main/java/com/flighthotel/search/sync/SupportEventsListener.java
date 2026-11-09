package com.flighthotel.search.sync;

import static com.flighthotel.search.index.SearchCategory.TICKETS;

import java.util.List;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.listener.AbstractConsumerSeekAware;
import org.springframework.stereotype.Component;

import com.flighthotel.events.support.SupportTicketSnapshot;
import com.flighthotel.search.index.Fields;
import com.flighthotel.search.index.IndexWriter;
import com.flighthotel.search.support.Format;

/** support.events → support ticket documents (TICKETS), from the full {@code SupportTicketSnapshot}. */
@Component
public class SupportEventsListener extends AbstractConsumerSeekAware {

    static final List<String> TICKET_FIELDS = List.of("category", "entityId", "title", "subtitle", "identifiers",
            "status", "priority", "type", "date", "createdAt", "ownerUserId", "bookingId", "display");

    private final IndexWriter writer;

    public SupportEventsListener(IndexWriter writer) {
        this.writer = writer;
    }

    @KafkaListener(id = "search-support", groupId = "search-support", topics = "support.events")
    public void onEvent(ConsumerRecord<String, Object> record) {
        handle(record.value());
    }

    /** Also called directly by tests. */
    public void handle(Object event) {
        if (event instanceof SupportTicketSnapshot e) {
            Fields fields = Fields.of(TICKETS, e.getTicketId())
                    .put("title", e.getSubject())
                    .put("subtitle", Format.join(e.getTicketNumber(), Format.humanize(e.getCategory())))
                    .add("identifiers", e.getTicketNumber(), e.getTicketId(), e.getCustomerEmail(),
                            e.getBookingReference())
                    .put("status", e.getStatus())
                    .put("priority", e.getPriority())
                    .put("type", e.getCategory())
                    .put("date", e.getLastMessageAt() != null ? e.getLastMessageAt() : e.getCreatedAt())
                    .put("createdAt", e.getCreatedAt())
                    .put("ownerUserId", e.getUserId())
                    .put("bookingId", e.getBookingId())
                    .put("display", Format.map("ticketNumber", e.getTicketNumber(),
                            "customerEmail", e.getCustomerEmail(), "bookingReference", e.getBookingReference()));
            writer.replaceState(TICKETS, e.getTicketId(), e.getChangedAt(), fields, TICKET_FIELDS);
        }
    }
}
