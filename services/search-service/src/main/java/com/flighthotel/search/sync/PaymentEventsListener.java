package com.flighthotel.search.sync;

import static com.flighthotel.search.index.SearchCategory.BOOKINGS;
import static com.flighthotel.search.index.SearchCategory.PAYMENTS;
import static com.flighthotel.search.index.SearchCategory.REFUNDS;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.listener.AbstractConsumerSeekAware;
import org.springframework.stereotype.Component;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.payment.InvoiceIssued;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.events.payment.RefundFailed;
import com.flighthotel.search.index.Fields;
import com.flighthotel.search.index.IndexWriter;
import com.flighthotel.search.index.IndexWriter.Merge;
import com.flighthotel.search.support.Format;

/**
 * payment.events → payment documents (PAYMENTS) and refund outcomes (REFUNDS).
 * <p>
 * A payment's status is ranked: SUCCEEDED (2) beats FAILED (1), so a late "failed" never hides a captured payment.
 * Refunds: COMPLETED (3) beats FAILED (2) beats REQUESTED (1, from booking.events). The booking reference is copied
 * from the booking document when it is already indexed; otherwise {@code BookingEventsListener} fills it in later.
 */
@Component
public class PaymentEventsListener extends AbstractConsumerSeekAware {

    private final IndexWriter writer;

    public PaymentEventsListener(IndexWriter writer) {
        this.writer = writer;
    }

    @KafkaListener(id = "search-payments", groupId = "search-payments", topics = "payment.events")
    public void onEvent(ConsumerRecord<String, Object> record) {
        handle(record.value());
    }

    /** Also called directly by tests. */
    public void handle(Object event) {
        switch (event) {
            case PaymentSucceeded e -> payment(e.getPaymentId(), e.getBookingId(), e.getUserId(), e.getSucceededAt(),
                    Fields.partial()
                            .add("identifiers", e.getPaymentId(), e.getProviderPaymentId())
                            .put("provider", e.getProvider())
                            .put("method", e.getMethod())
                            .add("keywords", Format.humanize(e.getMethod()))
                            .put("amount", EventMoney.amount(e.getAmount()))
                            .put("currency", e.getAmount().getCurrency()),
                    "SUCCEEDED", 2);
            case PaymentFailed e -> payment(e.getPaymentId(), e.getBookingId(), e.getUserId(), e.getFailedAt(),
                    Fields.partial()
                            .add("identifiers", e.getPaymentId())
                            .put("provider", e.getProvider())
                            .put("description", Format.firstNonBlank(e.getFailureReason(), e.getFailureCode())),
                    "FAILED", 1);
            case RefundCompleted e -> refund(e.getRefundRequestId(), e.getRefundId(), e.getPaymentId(),
                    e.getBookingId(), e.getUserId(), e.getCompletedAt(), Fields.partial()
                            .put("amount", EventMoney.amount(e.getAmount()))
                            .put("currency", e.getAmount().getCurrency()),
                    "COMPLETED", 3);
            case RefundFailed e -> refund(e.getRefundRequestId(), e.getRefundId(), e.getPaymentId(), e.getBookingId(),
                    e.getUserId(), e.getFailedAt(), Fields.partial()
                            .put("amount", EventMoney.amount(e.getAmount()))
                            .put("currency", e.getAmount().getCurrency()),
                    "FAILED", 2);
            case InvoiceIssued e -> {
                Fields fields = Fields.partial()
                        .add("extraIdentifiers", e.getInvoiceNumber())
                        .add("identifiers", e.getBillingEmail())
                        .add("names", e.getBillingName());
                if (e.getBookingReference() != null) {
                    fields.put("reference", e.getBookingReference())
                            .put("title", "Payment for " + e.getBookingReference())
                            .add("identifiers", e.getBookingReference());
                }
                writer.merge(PAYMENTS, e.getPaymentId(), Merge.of(fields).union());
            }
            default -> {
                // Other payment events change nothing that is searched.
            }
        }
    }

    private void payment(String paymentId, String bookingId, String userId, Instant at, Fields fields, String status,
            int rank) {
        fields.put("ownerUserId", userId).put("bookingId", bookingId).put("date", at);
        Fields ifAbsent = Fields.partial().put("title", "Payment " + Format.shortId(paymentId)).put("createdAt", at);
        booking(bookingId).ifPresent(booking -> {
            addBooking(fields, booking, "Payment for ");
            ifAbsent.put("amount", booking.get("amount")).put("currency", booking.get("currency"));
        });
        writer.merge(PAYMENTS, paymentId, Merge.of(fields).ifAbsent(ifAbsent).union().status(status, rank).complete());
    }

    private void refund(String refundRequestId, String refundId, String paymentId, String bookingId, String userId,
            Instant at, Fields fields, String status, int rank) {
        fields.add("identifiers", refundRequestId, refundId, paymentId).put("ownerUserId", userId)
                .put("bookingId", bookingId);
        Fields ifAbsent = Fields.partial().put("title", "Refund " + Format.shortId(refundRequestId)).put("date", at)
                .put("createdAt", at);
        booking(bookingId).ifPresent(booking -> addBooking(fields, booking, "Refund for "));
        writer.merge(REFUNDS, refundRequestId, Merge.of(fields).ifAbsent(ifAbsent).union().status(status, rank)
                .complete());
    }

    /** The booking document, when the booking was indexed already. */
    private Optional<Map<String, Object>> booking(String bookingId) {
        return bookingId == null ? Optional.empty() : writer.find(BOOKINGS, bookingId)
                .filter(booking -> booking.get("reference") != null);
    }

    private static void addBooking(Fields fields, Map<String, Object> booking, String titlePrefix) {
        String reference = String.valueOf(booking.get("reference"));
        Object display = booking.get("display");
        Object email = display instanceof Map<?, ?> map ? map.get("contactEmail") : null;
        fields.put("reference", reference)
                .put("title", titlePrefix + reference)
                .add("identifiers", reference, email)
                .add("keywords", booking.get("title"))
                .put("type", booking.get("type"));
    }
}
