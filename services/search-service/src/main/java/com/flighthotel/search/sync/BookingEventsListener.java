package com.flighthotel.search.sync;

import static com.flighthotel.search.index.SearchCategory.BOOKINGS;
import static com.flighthotel.search.index.SearchCategory.REFUNDS;

import java.util.ArrayList;
import java.util.List;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.listener.AbstractConsumerSeekAware;
import org.springframework.stereotype.Component;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.BookingInitiated;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.booking.BookingSnapshot;
import com.flighthotel.search.index.Fields;
import com.flighthotel.search.index.IndexWriter;
import com.flighthotel.search.index.IndexWriter.Merge;
import com.flighthotel.search.support.Format;

/**
 * booking.events → booking documents (BOOKINGS) and refund requests (REFUNDS).
 * <ul>
 *   <li>{@code BookingSnapshot} carries the whole booking after every change: it is the main state.</li>
 *   <li>{@code BookingInitiated}, {@code BookingConfirmed}, {@code BookingCancelled} add the travellers' names,
 *       hotel / flight details and confirmation numbers, so those can be searched too.</li>
 * </ul>
 */
@Component
public class BookingEventsListener extends AbstractConsumerSeekAware {

    /**
     * Every field the snapshot writes (and so may remove when a newer snapshot lacks it). {@code hotelId} is left out on
     * purpose: hotel-service's HotelInventoryHeld also sets it, and a manager must never lose sight of a reservation.
     */
    static final List<String> BOOKING_FIELDS = List.of("category", "entityId", "title", "subtitle", "keywords",
            "identifiers", "reference", "status", "paymentStatus", "type", "amount", "currency", "date", "endDate",
            "createdAt", "ownerUserId", "bookingId", "display");

    private final IndexWriter writer;

    public BookingEventsListener(IndexWriter writer) {
        this.writer = writer;
    }

    @KafkaListener(id = "search-bookings", groupId = "search-bookings", topics = "booking.events")
    public void onEvent(ConsumerRecord<String, Object> record) {
        handle(record.value());
    }

    /** Also called directly by tests. */
    public void handle(Object event) {
        switch (event) {
            case BookingSnapshot e -> snapshot(e);
            case BookingInitiated e -> writer.merge(BOOKINGS, e.getBookingId(), Merge.of(Fields.partial()
                    .add("names", travellers(e))).union());
            case BookingConfirmed e -> writer.merge(BOOKINGS, e.getBookingId(), Merge.of(confirmed(e)).union());
            case BookingCancelled e -> writer.merge(BOOKINGS, e.getBookingId(), Merge.of(Fields.partial()
                    .add("names", e.getCustomerName())).union());
            case BookingRefundRequested e -> writer.merge(REFUNDS, e.getRefundRequestId(), Merge.of(Fields.partial()
                    .put("title", "Refund for " + e.getBookingReference())
                    .put("reference", e.getBookingReference())
                    .add("identifiers", e.getRefundRequestId(), e.getBookingReference(), e.getPaymentId(),
                            e.getContactEmail())
                    .add("names", e.getCustomerName())
                    .put("description", e.getReason())
                    .put("amount", EventMoney.amount(e.getAmount()))
                    .put("currency", e.getAmount().getCurrency())
                    .put("ownerUserId", e.getUserId())
                    .put("bookingId", e.getBookingId())
                    .put("date", e.getRequestedAt())
                    .put("createdAt", e.getRequestedAt()))
                    .union().status("REQUESTED", 1).complete());
            default -> {
                // Other booking events only move the status, and every move also publishes a BookingSnapshot.
            }
        }
    }

    private void snapshot(BookingSnapshot e) {
        String type = e.getBookingType();
        String title = Format.firstNonBlank(e.getTitle(), e.getDestination(), e.getBookingReference());
        Fields fields = Fields.of(BOOKINGS, e.getBookingId())
                .put("title", title)
                .put("subtitle", Format.join(e.getBookingReference(), "HOTEL".equals(type) ? "Hotel" : "Flight",
                        Format.dateRange(e.getStartDate(), e.getEndDate())))
                .add("keywords", e.getDestination(), e.getOriginCity(), e.getTitle())
                .add("identifiers", e.getBookingReference(), e.getBookingId(), e.getContactEmail(), e.getCouponCode(),
                        e.getRouteOrigin(), e.getRouteDestination())
                .put("reference", e.getBookingReference())
                .put("status", e.getStatus())
                .put("paymentStatus", e.getPaymentStatus())
                .put("type", type)
                .put("amount", EventMoney.amount(e.getTotalAmount()))
                .put("currency", e.getTotalAmount().getCurrency())
                .put("date", e.getStartDate())
                .put("endDate", e.getEndDate())
                .put("createdAt", e.getCreatedAt())
                .put("ownerUserId", e.getUserId())
                .put("hotelId", e.getHotelId())
                .put("bookingId", e.getBookingId())
                .put("display", Format.map("contactEmail", e.getContactEmail(), "destination", e.getDestination(),
                        "refunded", EventMoney.amount(e.getRefundedAmount()), "demo", e.getDemo()));
        // Payments and refunds handled before this booking had a reference could not copy it: give it to them now.
        boolean firstReference = writer.find(BOOKINGS, e.getBookingId())
                .map(stored -> stored.get("reference") == null).orElse(true);
        writer.replaceState(BOOKINGS, e.getBookingId(), e.getChangedAt(), fields, BOOKING_FIELDS);
        if (firstReference) {
            writer.fillBookingReference(e.getBookingId(), e.getBookingReference(), title, e.getContactEmail(), type);
        }
    }

    private static List<String> travellers(BookingInitiated e) {
        List<String> names = new ArrayList<>();
        if (e.getHotel() != null) {
            e.getHotel().getGuests().forEach(guest -> names.add(guest.getFirstName() + " " + guest.getLastName()));
        }
        if (e.getFlight() != null) {
            e.getFlight().getPassengers().forEach(p -> names.add(p.getFirstName() + " " + p.getLastName()));
        }
        return names;
    }

    private static Fields confirmed(BookingConfirmed e) {
        Fields fields = Fields.partial().add("names", e.getCustomerName());
        if (e.getHotel() != null) {
            var hotel = e.getHotel();
            fields.add("details", hotel.getHotelName(), hotel.getHotelCity(), hotel.getRoomTypeName(),
                    hotel.getRatePlanName());
            fields.add("extraIdentifiers", hotel.getConfirmationNumber());
        }
        if (e.getFlight() != null) {
            var flight = e.getFlight();
            fields.add("details", flight.getTitle());
            fields.add("extraIdentifiers", flight.getPnr());
            flight.getPassengers().forEach(p -> fields
                    .add("names", p.getFirstName() + " " + p.getLastName())
                    .add("extraIdentifiers", p.getTicketNumber()));
            FlightTexts.addSlices(fields, flight.getSlices());
        }
        return fields;
    }
}
