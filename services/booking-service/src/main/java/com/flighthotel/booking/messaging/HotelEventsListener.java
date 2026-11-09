package com.flighthotel.booking.messaging;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.service.BookingSaga;
import com.flighthotel.booking.service.CancellationSaga;
import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.hotel.GuestCheckedIn;
import com.flighthotel.events.hotel.GuestCheckedOut;
import com.flighthotel.events.hotel.HotelInventoryHeld;
import com.flighthotel.events.hotel.HotelInventoryHoldFailed;
import com.flighthotel.events.hotel.HotelInventoryReleased;
import com.flighthotel.events.hotel.HotelReservationCancellationFailed;
import com.flighthotel.events.hotel.HotelReservationCancelled;
import com.flighthotel.events.hotel.HotelReservationConfirmed;
import com.flighthotel.events.hotel.HotelReservationFailed;

/** hotel-service's answers in the hotel booking saga. Each event is handled once (inbox), in one transaction. */
@Component
public class HotelEventsListener {

    static final String CONSUMER = "booking-service-hotel";

    private final ProcessedEventStore processedEvents;
    private final BookingSaga saga;
    private final CancellationSaga cancellations;

    public HotelEventsListener(ProcessedEventStore processedEvents, BookingSaga saga,
            CancellationSaga cancellations) {
        this.processedEvents = processedEvents;
        this.saga = saga;
        this.cancellations = cancellations;
    }

    @KafkaListener(id = CONSUMER, groupId = CONSUMER, topics = "hotel.events")
    @Transactional
    public void onHotelEvent(ConsumerRecord<String, Object> record) {
        handle(EventHeaders.eventId(record), record.value());
    }

    /** Also called directly by tests (same transaction rules). */
    @Transactional
    public void handle(String eventId, Object event) {
        if (!processedEvents.markProcessed(eventId, CONSUMER)) {
            return;
        }
        switch (event) {
            case HotelInventoryHeld held -> saga.inventoryHeld(held, eventId);
            case HotelInventoryHoldFailed failed -> saga.holdFailed(failed, eventId);
            case HotelReservationConfirmed confirmed -> saga.reservationConfirmed(confirmed, eventId);
            case HotelReservationFailed failed -> saga.reservationFailed(failed, eventId);
            case HotelInventoryReleased released -> saga.inventoryReleased(released, eventId);
            case HotelReservationCancelled cancelled -> cancellations.hotelCancelled(cancelled, eventId);
            case HotelReservationCancellationFailed failed -> cancellations.hotelCancellationFailed(failed, eventId);
            case GuestCheckedIn checkedIn -> saga.guestCheckedIn(checkedIn, eventId);
            case GuestCheckedOut checkedOut -> saga.guestCheckedOut(checkedOut, eventId);
            default -> {
                // HotelCatalogChanged and other hotel events are not booking business.
            }
        }
    }
}
