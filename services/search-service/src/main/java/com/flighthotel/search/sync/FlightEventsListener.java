package com.flighthotel.search.sync;

import static com.flighthotel.search.index.SearchCategory.BOOKINGS;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.listener.AbstractConsumerSeekAware;
import org.springframework.stereotype.Component;

import com.flighthotel.events.flight.FlightBookingConfirmed;
import com.flighthotel.events.flight.FlightOfferHeld;
import com.flighthotel.search.index.Fields;
import com.flighthotel.search.index.IndexWriter;
import com.flighthotel.search.index.IndexWriter.Merge;

/**
 * flight.events → details of flight bookings: airlines, cities and flight numbers ({@code FlightOfferHeld}), the PNR and
 * ticket numbers ({@code FlightBookingConfirmed}). Flight offers themselves are short-lived supplier prices and are
 * not indexed: "Flights to Mumbai" is answered by the Mumbai destination, which links to the flight search.
 */
@Component
public class FlightEventsListener extends AbstractConsumerSeekAware {

    private final IndexWriter writer;

    public FlightEventsListener(IndexWriter writer) {
        this.writer = writer;
    }

    @KafkaListener(id = "search-flights", groupId = "search-flights", topics = "flight.events")
    public void onEvent(ConsumerRecord<String, Object> record) {
        handle(record.value());
    }

    /** Also called directly by tests. */
    public void handle(Object event) {
        switch (event) {
            case FlightOfferHeld e -> {
                Fields fields = Fields.partial().add("details", e.getTitle());
                FlightTexts.addSlices(fields, e.getSlices());
                writer.merge(BOOKINGS, e.getBookingId(), Merge.of(fields).union());
            }
            case FlightBookingConfirmed e -> {
                Fields fields = Fields.partial().add("extraIdentifiers", e.getPnr(), e.getSupplierOrderId());
                e.getTickets().forEach(ticket -> fields.add("extraIdentifiers", ticket.getTicketNumber()));
                writer.merge(BOOKINGS, e.getBookingId(), Merge.of(fields).union());
            }
            default -> {
                // Holds released, failures and the like change nothing that is searched.
            }
        }
    }
}
