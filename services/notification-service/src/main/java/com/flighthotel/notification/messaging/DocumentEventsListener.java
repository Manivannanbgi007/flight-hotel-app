package com.flighthotel.notification.messaging;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.booking.BookingAwaitingPayment;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingCompleted;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.ConfirmedFlightTrip;
import com.flighthotel.events.booking.ConfirmedHotelStay;
import com.flighthotel.events.common.FlightSlice;
import com.flighthotel.events.payment.InvoiceIssued;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.notification.document.DocumentService;
import com.flighthotel.notification.projection.BookingContacts;
import com.flighthotel.notification.projection.UpcomingTrips;
import com.flighthotel.notification.projection.UpcomingTrips.Row;
import com.flighthotel.notification.projection.UpcomingTrips.Trip;

/**
 * Keeps the projections (booking contacts, upcoming trips) and generates the PDF documents, in its own consumer group
 * so documents do not depend on e-mail delivery. Started with {@code auto-offset-reset: earliest}, the group also makes
 * the documents of bookings that are still in the topics' retention when it first runs.
 */
@Component
public class DocumentEventsListener {

    static final String BOOKINGS = "notification-documents-bookings";
    static final String PAYMENTS = "notification-documents-payments";
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("EEE, d MMM yyyy, HH:mm", Locale.ENGLISH);

    private final ProcessedEventStore processedEvents;
    private final BookingContacts contacts;
    private final UpcomingTrips trips;
    private final DocumentService documents;
    private final Duration reminderLeadTime;
    private final Clock clock;

    public DocumentEventsListener(ProcessedEventStore processedEvents, BookingContacts contacts, UpcomingTrips trips,
            DocumentService documents, @Value("${notification.reminders.lead-time:24h}") Duration reminderLeadTime,
            Clock clock) {
        this.processedEvents = processedEvents;
        this.contacts = contacts;
        this.trips = trips;
        this.documents = documents;
        this.reminderLeadTime = reminderLeadTime;
        this.clock = clock;
    }

    @KafkaListener(id = BOOKINGS, groupId = BOOKINGS, topics = "booking.events")
    @Transactional
    public void onBookingEvent(ConsumerRecord<String, Object> record) {
        handleBookingEvent(EventHeaders.eventId(record), record.value());
    }

    @KafkaListener(id = PAYMENTS, groupId = PAYMENTS, topics = "payment.events")
    @Transactional
    public void onPaymentEvent(ConsumerRecord<String, Object> record) {
        handlePaymentEvent(EventHeaders.eventId(record), record.value());
    }

    /** Also called directly by tests (same transaction rules). */
    @Transactional
    public void handleBookingEvent(String eventId, Object event) {
        if (!processedEvents.markProcessed(eventId, BOOKINGS)) {
            return;
        }
        Instant now = clock.instant();
        switch (event) {
            case BookingAwaitingPayment awaiting -> contacts.held(UUID.fromString(awaiting.getBookingId()),
                    UUID.fromString(awaiting.getUserId()), awaiting.getBookingReference(), awaiting.getBookingType(),
                    awaiting.getDescription(), awaiting.getContactEmail(), now);
            case BookingConfirmed confirmed -> confirmed(confirmed, now);
            case BookingCancelled cancelled -> {
                documents.cancellation(cancelled);
                trips.ended(UUID.fromString(cancelled.getBookingId()), "CANCELLED");
            }
            case BookingCompleted completed -> trips.ended(UUID.fromString(completed.getBookingId()), "COMPLETED");
            default -> {
                // Nothing to keep or generate for the other booking events.
            }
        }
    }

    @Transactional
    public void handlePaymentEvent(String eventId, Object event) {
        if (!processedEvents.markProcessed(eventId, PAYMENTS)) {
            return;
        }
        switch (event) {
            case PaymentSucceeded succeeded -> documents.paymentReceipt(succeeded);
            case InvoiceIssued invoice -> documents.invoice(invoice);
            case RefundCompleted completed -> documents.refundReceipt(completed);
            default -> {
                // Failed payments and refunds have no document.
            }
        }
    }

    private void confirmed(BookingConfirmed confirmed, Instant now) {
        UUID bookingId = UUID.fromString(confirmed.getBookingId());
        UUID userId = UUID.fromString(confirmed.getUserId());
        boolean flight = confirmed.getFlight() != null;
        contacts.confirmed(bookingId, userId, confirmed.getBookingReference(), confirmed.getBookingType(),
                confirmed.getContactEmail(), confirmed.getCustomerName(),
                flight ? confirmed.getFlight().getDemo() : confirmed.getHotel().getDemo(), now);
        documents.confirmation(confirmed);
        documents.eTicket(confirmed);

        Instant startsAt = startsAt(confirmed);
        String title = flight ? confirmed.getFlight().getTitle() : confirmed.getHotel().getHotelName();
        trips.confirmed(new Trip(bookingId, userId, confirmed.getBookingReference(), confirmed.getBookingType(), title,
                        confirmed.getContactEmail(), confirmed.getCustomerName(), startsAt, details(confirmed)),
                confirmed.getConfirmedAt(), startsAt.minus(reminderLeadTime).isAfter(confirmed.getConfirmedAt()));
    }

    /** From the event; events of older bookings did not say, so their local time is read as India time. */
    private static Instant startsAt(BookingConfirmed confirmed) {
        if (confirmed.getStartsAt() != null) {
            return confirmed.getStartsAt();
        }
        if (confirmed.getFlight() != null) {
            return LocalDateTime.parse(confirmed.getFlight().getSlices().getFirst().getDepartureLocal()).atZone(INDIA)
                    .toInstant();
        }
        ConfirmedHotelStay stay = confirmed.getHotel();
        return stay.getCheckIn().atTime(LocalTime.parse(stay.getCheckInTime())).atZone(INDIA).toInstant();
    }

    /** What the reminder e-mail shows. */
    private static List<Row> details(BookingConfirmed confirmed) {
        List<Row> rows = new ArrayList<>();
        if (confirmed.getFlight() != null) {
            ConfirmedFlightTrip trip = confirmed.getFlight();
            FlightSlice first = trip.getSlices().getFirst();
            rows.add(new Row("Flight", first.getSegments().getFirst().getFlightNumber() + " · "
                    + first.getOriginCity() + " (" + first.getOrigin() + ") to " + first.getDestinationCity() + " ("
                    + first.getDestination() + ")"));
            rows.add(new Row("Departs", WHEN.format(LocalDateTime.parse(first.getDepartureLocal())) + " (local time)"));
            rows.add(new Row("Airline booking reference (PNR)", trip.getPnr()));
            rows.add(new Row("Baggage", "Checked " + trip.getCheckedBaggageKg() + " kg, cabin "
                    + trip.getCabinBaggageKg() + " kg"));
        } else {
            ConfirmedHotelStay stay = confirmed.getHotel();
            rows.add(new Row("Hotel", stay.getHotelName()));
            rows.add(new Row("Address", stay.getHotelAddress()));
            rows.add(new Row("Check-in", WHEN.format(stay.getCheckIn().atTime(LocalTime.parse(stay.getCheckInTime())))));
            rows.add(new Row("Hotel confirmation number", stay.getConfirmationNumber()));
        }
        return rows;
    }
}
