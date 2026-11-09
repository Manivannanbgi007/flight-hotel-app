package com.flighthotel.payment.messaging;

import java.util.UUID;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.booking.BookingAwaitingPayment;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.BookingExpired;
import com.flighthotel.events.booking.BookingFailed;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.payment.entity.PayableBooking;
import com.flighthotel.payment.repository.PayableBookingRepository;
import com.flighthotel.payment.service.InvoiceService;
import com.flighthotel.payment.service.RefundService;

/**
 * booking-service's messages that matter for money. Each event is handled once (inbox) in one transaction together
 * with its changes and the answers written to the outbox.
 */
@Component
public class BookingEventsListener {

    static final String CONSUMER = "payment-service-bookings";
    private static final Logger log = LoggerFactory.getLogger(BookingEventsListener.class);

    private final ProcessedEventStore processedEvents;
    private final PayableBookingRepository payables;
    private final RefundService refundService;
    private final InvoiceService invoiceService;

    public BookingEventsListener(ProcessedEventStore processedEvents, PayableBookingRepository payables,
            RefundService refundService, InvoiceService invoiceService) {
        this.processedEvents = processedEvents;
        this.payables = payables;
        this.refundService = refundService;
        this.invoiceService = invoiceService;
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
            case BookingAwaitingPayment awaiting -> awaitingPayment(awaiting);
            case BookingExpired expired -> payables.lockById(UUID.fromString(expired.getBookingId()))
                    .ifPresent(PayableBooking::expired);
            case BookingFailed failed -> payables.lockById(UUID.fromString(failed.getBookingId()))
                    .ifPresent(PayableBooking::cancelled);
            case BookingConfirmed confirmed -> invoiceService.issue(confirmed);
            case BookingRefundRequested refund -> refundService.requested(refund);
            default -> {
                // BookingInitiated, BookingPaid, BookingCompleted: nothing to do for payments.
            }
        }
    }

    private void awaitingPayment(BookingAwaitingPayment awaiting) {
        UUID bookingId = UUID.fromString(awaiting.getBookingId());
        if (payables.existsById(bookingId)) {
            log.info("Booking already known as payable bookingId={}", bookingId);
            return;
        }
        payables.save(new PayableBooking(bookingId, awaiting.getBookingReference(), awaiting.getBookingType(),
                UUID.fromString(awaiting.getUserId()), EventMoney.amount(awaiting.getAmount()),
                awaiting.getAmount().getCurrency(), awaiting.getDescription(), awaiting.getContactEmail(),
                awaiting.getPaymentDeadline()));
        log.info("Booking is payable bookingId={} amount={}", bookingId, awaiting.getAmount().getAmount());
    }
}
