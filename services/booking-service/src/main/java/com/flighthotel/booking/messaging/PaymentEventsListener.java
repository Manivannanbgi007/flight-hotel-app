package com.flighthotel.booking.messaging;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.service.BookingSaga;
import com.flighthotel.common.inbox.ProcessedEventStore;
import com.flighthotel.common.kafka.EventHeaders;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.events.payment.RefundFailed;

/** payment-service's answers: payments and refunds. Each event is handled once (inbox), in one transaction. */
@Component
public class PaymentEventsListener {

    static final String CONSUMER = "booking-service-payment";

    private final ProcessedEventStore processedEvents;
    private final BookingSaga saga;

    public PaymentEventsListener(ProcessedEventStore processedEvents, BookingSaga saga) {
        this.processedEvents = processedEvents;
        this.saga = saga;
    }

    @KafkaListener(id = CONSUMER, groupId = CONSUMER, topics = "payment.events")
    @Transactional
    public void onPaymentEvent(ConsumerRecord<String, Object> record) {
        handle(EventHeaders.eventId(record), record.value());
    }

    /** Also called directly by tests (same transaction rules). */
    @Transactional
    public void handle(String eventId, Object event) {
        if (!processedEvents.markProcessed(eventId, CONSUMER)) {
            return;
        }
        switch (event) {
            case PaymentSucceeded succeeded -> saga.paymentSucceeded(succeeded, eventId);
            case PaymentFailed failed -> saga.paymentFailed(failed, eventId);
            case RefundCompleted completed -> saga.refundCompleted(completed, eventId);
            case RefundFailed failed -> saga.refundFailed(failed, eventId);
            default -> {
                // InvoiceIssued: not needed by booking-service.
            }
        }
    }
}
