package com.flighthotel.payment.service;

import java.time.Instant;

import org.apache.avro.specific.SpecificRecord;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.events.payment.InvoiceIssued;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.events.payment.RefundFailed;
import com.flighthotel.payment.entity.Invoice;
import com.flighthotel.payment.entity.PaymentTransaction;
import com.flighthotel.payment.entity.Refund;

/**
 * payment-service messages ({@code payment.events}, key = booking id), always written to the outbox in the
 * transaction that changed the payment.
 */
@Component
public class PaymentEvents {

    static final String AGGREGATE_TYPE = "payment";

    private final OutboxEventPublisher outbox;

    public PaymentEvents(OutboxEventPublisher outbox) {
        this.outbox = outbox;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void succeeded(PaymentTransaction payment, Instant now) {
        publish(payment.getBookingId(), PaymentSucceeded.newBuilder()
                .setPaymentId(payment.getId().toString())
                .setBookingId(payment.getBookingId().toString())
                .setUserId(payment.getUserId().toString())
                .setProvider(payment.getProvider())
                .setProviderPaymentId(payment.getProviderPaymentId())
                .setAmount(EventMoney.of(payment.getAmount(), payment.getCurrency()))
                .setMethod(payment.getMethod())
                .setSucceededAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void failed(PaymentTransaction payment, Instant now) {
        publish(payment.getBookingId(), PaymentFailed.newBuilder()
                .setPaymentId(payment.getId().toString())
                .setBookingId(payment.getBookingId().toString())
                .setUserId(payment.getUserId().toString())
                .setProvider(payment.getProvider())
                .setFailureCode(payment.getFailureCode())
                .setFailureReason(payment.getFailureMessage())
                .setFailedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void refundCompleted(Refund refund, Instant now) {
        publish(refund.getBookingId(), RefundCompleted.newBuilder()
                .setRefundId(refund.getId().toString())
                .setRefundRequestId(refund.getIdempotencyKey())
                .setPaymentId(refund.getPaymentId().toString())
                .setBookingId(refund.getBookingId().toString())
                .setUserId(refund.getUserId().toString())
                .setAmount(EventMoney.of(refund.getAmount(), refund.getCurrency()))
                .setCompletedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void refundFailed(Refund refund, String reason, Instant now) {
        publish(refund.getBookingId(), RefundFailed.newBuilder()
                .setRefundId(refund.getId().toString())
                .setRefundRequestId(refund.getIdempotencyKey())
                .setPaymentId(refund.getPaymentId().toString())
                .setBookingId(refund.getBookingId().toString())
                .setUserId(refund.getUserId().toString())
                .setAmount(EventMoney.of(refund.getAmount(), refund.getCurrency()))
                .setReason(reason == null ? "Refund failed" : reason)
                .setFailedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void invoiceIssued(Invoice invoice) {
        publish(invoice.getBookingId(), InvoiceIssued.newBuilder()
                .setInvoiceId(invoice.getId().toString())
                .setInvoiceNumber(invoice.getInvoiceNumber())
                .setBookingId(invoice.getBookingId().toString())
                .setPaymentId(invoice.getPaymentId().toString())
                .setUserId(invoice.getUserId().toString())
                .setTotalAmount(EventMoney.of(invoice.getTotalAmount(), invoice.getCurrency()))
                .setIssuedAt(invoice.getIssuedAt())
                // Phase 8: everything the invoice PDF shows.
                .setBookingReference(invoice.getBookingReference())
                .setBillingName(invoice.getBillingName())
                .setBillingEmail(invoice.getBillingEmail())
                .setDescription(invoice.getDescription())
                .setTaxableAmount(EventMoney.of(invoice.getTaxableAmount(), invoice.getCurrency()))
                .setTaxAmount(EventMoney.of(invoice.getTaxAmount(), invoice.getCurrency()))
                .setDiscountAmount(EventMoney.of(invoice.getDiscountAmount(), invoice.getCurrency()))
                .build());
    }

    private void publish(java.util.UUID bookingId, SpecificRecord event) {
        outbox.publish(AGGREGATE_TYPE, bookingId.toString(), event);
    }
}
