package com.flighthotel.booking.messaging;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.service.CancellationSaga;
import com.flighthotel.booking.service.FlightSaga;
import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.flight.FlightBookingCancelled;
import com.flighthotel.events.flight.FlightBookingConfirmed;
import com.flighthotel.events.flight.FlightBookingFailed;
import com.flighthotel.events.flight.FlightBookingUncertain;
import com.flighthotel.events.flight.FlightCancellationFailed;
import com.flighthotel.events.flight.FlightOfferHeld;
import com.flighthotel.events.flight.FlightOfferHoldFailed;
import com.flighthotel.events.flight.FlightOfferReleased;

/** flight-service's answers in the flight booking saga. Each event is handled once (inbox), in one transaction. */
@Component
public class FlightEventsListener {

    static final String CONSUMER = "booking-service-flights";

    private final ProcessedEventStore processedEvents;
    private final FlightSaga saga;
    private final CancellationSaga cancellations;

    public FlightEventsListener(ProcessedEventStore processedEvents, FlightSaga saga,
            CancellationSaga cancellations) {
        this.processedEvents = processedEvents;
        this.saga = saga;
        this.cancellations = cancellations;
    }

    @KafkaListener(id = CONSUMER, groupId = CONSUMER, topics = "flight.events")
    @Transactional
    public void onFlightEvent(ConsumerRecord<String, Object> record) {
        handle(EventHeaders.eventId(record), record.value());
    }

    /** Also called directly by tests (same transaction rules). */
    @Transactional
    public void handle(String eventId, Object event) {
        if (!processedEvents.markProcessed(eventId, CONSUMER)) {
            return;
        }
        switch (event) {
            case FlightOfferHeld held -> saga.held(held, eventId);
            case FlightOfferHoldFailed failed -> saga.holdFailed(failed, eventId);
            case FlightOfferReleased released -> saga.released(released, eventId);
            case FlightBookingConfirmed confirmed -> saga.confirmed(confirmed, eventId);
            case FlightBookingFailed failed -> saga.failed(failed, eventId);
            case FlightBookingUncertain uncertain -> saga.uncertain(uncertain, eventId);
            case FlightBookingCancelled cancelled -> cancellations.flightCancelled(cancelled, eventId);
            case FlightCancellationFailed failed -> cancellations.flightCancellationFailed(failed, eventId);
            default -> {
                // Events booking-service does not act on.
            }
        }
    }
}
