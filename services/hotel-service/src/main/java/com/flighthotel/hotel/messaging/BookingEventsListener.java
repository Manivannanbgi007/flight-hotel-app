package com.flighthotel.hotel.messaging;

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
import com.flighthotel.hotel.reservation.ReservationService;

/**
 * hotel-service's side of the hotel booking saga. Each event is handled once (inbox) in one transaction together with
 * the inventory change and the answer in the outbox.
 */
@Component
public class BookingEventsListener {

    static final String CONSUMER = "hotel-service-bookings";
    static final String HOTEL = "HOTEL";

    private final ProcessedEventStore processedEvents;
    private final ReservationService reservations;

    public BookingEventsListener(ProcessedEventStore processedEvents, ReservationService reservations) {
        this.processedEvents = processedEvents;
        this.reservations = reservations;
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
            case BookingInitiated initiated when initiated.getHotel() != null -> reservations.hold(initiated);
            case BookingPaid paid when HOTEL.equals(paid.getBookingType()) ->
                    reservations.confirm(UUID.fromString(paid.getBookingId()));
            case BookingFailed failed when HOTEL.equals(failed.getBookingType()) ->
                    reservations.release(UUID.fromString(failed.getBookingId()), "BOOKING_FAILED");
            case BookingExpired expired when HOTEL.equals(expired.getBookingType()) ->
                    reservations.release(UUID.fromString(expired.getBookingId()), "BOOKING_EXPIRED");
            case BookingCancellationRequested cancel when HOTEL.equals(cancel.getBookingType()) ->
                    reservations.cancel(cancel);
            default -> {
                // Flight bookings and booking events hotel-service does not act on.
            }
        }
    }
}
