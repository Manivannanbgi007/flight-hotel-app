package com.flighthotel.flight.booking;

import java.util.UUID;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.booking.BookingCancellationRequested;
import com.flighthotel.events.booking.BookingExpired;
import com.flighthotel.events.booking.BookingFailed;
import com.flighthotel.events.booking.BookingInitiated;
import com.flighthotel.events.booking.BookingPaid;

/** flight-service's side of the flight booking saga. Each event is handled once (inbox) in one transaction. */
@Component
public class BookingEventsListener {

    static final String CONSUMER = "flight-service-bookings";
    static final String FLIGHT = "FLIGHT";

    private final ProcessedEventStore processedEvents;
    private final HoldService holds;
    private final CancellationService cancellations;

    public BookingEventsListener(ProcessedEventStore processedEvents, HoldService holds,
            CancellationService cancellations) {
        this.processedEvents = processedEvents;
        this.holds = holds;
        this.cancellations = cancellations;
    }

    @KafkaListener(id = CONSUMER, groupId = CONSUMER, topics = "booking.events")
    @Transactional
    public void onBookingEvent(ConsumerRecord<String, Object> record) {
        handle(EventHeaders.eventId(record), record.value());
    }

    /** Also called directly by tests (same transaction rules). */
    @Transactional
    public void handle(String eventId, Object event) {
        if (!processedEvents.markProcessed(eventId, CONSUMER)) {
            return;
        }
        switch (event) {
            case BookingInitiated initiated when initiated.getFlight() != null -> holds.hold(initiated);
            case BookingPaid paid when FLIGHT.equals(paid.getBookingType()) ->
                    holds.confirm(UUID.fromString(paid.getBookingId()));
            case BookingFailed failed when FLIGHT.equals(failed.getBookingType()) ->
                    holds.release(UUID.fromString(failed.getBookingId()), "BOOKING_FAILED");
            case BookingExpired expired when FLIGHT.equals(expired.getBookingType()) ->
                    holds.release(UUID.fromString(expired.getBookingId()), "BOOKING_EXPIRED");
            case BookingCancellationRequested cancel when FLIGHT.equals(cancel.getBookingType()) ->
                    cancellations.cancel(cancel);
            default -> {
                // Hotel bookings and booking events flight-service does not act on.
            }
        }
    }
}
