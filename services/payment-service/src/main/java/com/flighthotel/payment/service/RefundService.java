package com.flighthotel.payment.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.Roles;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.payment.config.PaymentProviders;
import com.flighthotel.payment.entity.PaymentTransaction;
import com.flighthotel.payment.entity.Refund;
import com.flighthotel.payment.provider.PaymentProvider.ProviderRefund;
import com.flighthotel.payment.provider.ProviderException;
import com.flighthotel.payment.repository.PaymentTransactionRepository;
import com.flighthotel.payment.repository.RefundRepository;

/**
 * Money back to the customer (PAYMENT_INTEGRATION.md section 5). Started only by a {@code BookingRefundRequested}
 * event; each request id is refunded at most once, and the refunds of a payment never exceed what was captured.
 * A request that is asked again (booking-service's reconciliation) gets the same final answer again. Every step is
 * audited and shown live ({@code refund.status-changed}).
 */
@Service
public class RefundService {

    private static final Logger log = LoggerFactory.getLogger(RefundService.class);

    private final PaymentTransactionRepository payments;
    private final RefundRepository refunds;
    private final PaymentProviders providers;
    private final PaymentEvents events;
    private final RealtimePublisher realtime;
    private final AuditPublisher audit;
    private final Clock clock;

    public RefundService(PaymentTransactionRepository payments, RefundRepository refunds, PaymentProviders providers,
            PaymentEvents events, RealtimePublisher realtime, AuditPublisher audit, Clock clock) {
        this.payments = payments;
        this.refunds = refunds;
        this.providers = providers;
        this.events = events;
        this.realtime = realtime;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Runs in the Kafka listener's transaction. A provider that cannot be reached throws, so the whole step is rolled
     * back and retried; the provider call carries the request id as idempotency key, so a retry never refunds twice.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void requested(BookingRefundRequested request) {
        String key = request.getRefundRequestId();
        Refund known = refunds.findByIdempotencyKey(key).orElse(null);
        if (known != null) {
            repeatAnswer(known);
            return;
        }
        PaymentTransaction payment = payments.lockById(UUID.fromString(request.getPaymentId())).orElse(null);
        if (payment == null) {
            log.error("Refund requested for an unknown payment paymentId={} refundRequestId={}",
                    request.getPaymentId(), key);
            return;
        }
        BigDecimal amount = EventMoney.amount(request.getAmount());
        // Money still refundable: what was captured, minus refunds done, minus refunds already on their way.
        BigDecimal available = payment.refundable().subtract(refunds.sumPendingByPaymentId(payment.getId()));
        Refund refund = refunds.save(new Refund(payment, amount, request.getReason(), key));
        Instant now = clock.instant();

        if (!payment.getStatus().isPaid() || amount.signum() <= 0 || amount.compareTo(available) > 0) {
            String reason = !payment.getStatus().isPaid() ? "The payment was never captured"
                    : "The refund is more than the money still refundable (" + available + ")";
            refund.failed(reason);
            events.refundFailed(refund, reason, now);
            audited("REFUND_FAILED", refund, reason);
            notifyCustomer(payment, refund);
            log.error("Refund refused paymentId={} refundRequestId={} reason={}", payment.getId(), key, reason);
            return;
        }

        payment.refundStarted();
        ProviderRefund providerRefund;
        try {
            providerRefund = providers.byCode(payment.getProvider()).refund(payment.getProviderPaymentId(), amount, key);
        } catch (ProviderException ex) {
            if (!ex.isRejected()) {
                throw ex;
            }
            refund.failed(ex.getMessage());
            payment.refundAborted();
            events.refundFailed(refund, ex.getMessage(), now);
            audited("REFUND_FAILED", refund, ex.getMessage());
            notifyCustomer(payment, refund);
            log.error("Provider rejected the refund paymentId={} refundRequestId={} error={}", payment.getId(), key,
                    ex.getMessage());
            return;
        }
        refund.sentToProvider(providerRefund.refundId());
        audited("REFUND_STARTED", refund, null);
        notifyCustomer(payment, refund);
        applyProviderRefund(refund, payment, providerRefund);
        log.info("Refund started refundId={} paymentId={} amount={} state={}", refund.getId(), payment.getId(),
                amount, providerRefund.state());
    }

    /** Applies the provider's answer about a refund (immediate answer, webhook or reconciliation). Repeatable. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void applyProviderRefund(Refund refund, PaymentTransaction payment, ProviderRefund providerRefund) {
        if (!refund.isPending()) {
            return;
        }
        Instant now = clock.instant();
        switch (providerRefund.state()) {
            case PROCESSED -> {
                refund.processed();
                payment.refundProcessed(refund.getAmount());
                events.refundCompleted(refund, now);
                audited("REFUND_PROCESSED", refund, null);
                notifyCustomer(payment, refund);
            }
            case FAILED -> {
                String reason = providerRefund.failure() == null ? "The provider could not refund" : providerRefund.failure();
                refund.failed(reason);
                payment.refundAborted();
                events.refundFailed(refund, reason, now);
                audited("REFUND_FAILED", refund, reason);
                notifyCustomer(payment, refund);
            }
            case PENDING -> {
                // Waiting for the provider: the refund webhook or the reconciliation job finishes it.
            }
        }
    }

    /** booking-service asked again about a request it has no answer to: a final outcome is published again. */
    private void repeatAnswer(Refund refund) {
        Instant now = clock.instant();
        switch (refund.getStatus()) {
            case PROCESSED -> events.refundCompleted(refund, now);
            case FAILED -> events.refundFailed(refund, refund.getFailureReason(), now);
            case PENDING -> {
                // Still waiting for the provider: the refund webhook or the reconciliation job finishes it.
            }
        }
        log.info("Refund request asked again refundRequestId={} status={}", refund.getIdempotencyKey(),
                refund.getStatus());
    }

    private void audited(String action, Refund refund, String failure) {
        Map<String, String> details = new LinkedHashMap<>();
        details.put("bookingId", refund.getBookingId().toString());
        details.put("paymentId", refund.getPaymentId().toString());
        details.put("refundRequestId", refund.getIdempotencyKey());
        details.put("amount", refund.getAmount().toPlainString());
        details.put("currency", refund.getCurrency());
        details.put("reason", refund.getReason());
        if (refund.getProviderRefundId() != null) {
            details.put("providerRefundId", refund.getProviderRefundId());
        }
        if (failure != null) {
            details.put("failure", failure.length() <= 200 ? failure : failure.substring(0, 200));
        }
        audit.record(action, "REFUND", refund.getId().toString(), details);
    }

    /** Open payment and booking screens refresh: the payment's status and the refund itself. */
    private void notifyCustomer(PaymentTransaction payment, Refund refund) {
        RealtimeAudience audience = RealtimeAudience.user(payment.getUserId()).andRoles(Roles.ADMIN,
                Roles.SUPPORT_AGENT);
        realtime.publish(RealtimeMessage.of("payment.status-changed", "PAYMENT", payment.getBookingId().toString(),
                Map.of("paymentId", payment.getId().toString(), "status", payment.getStatus().name())), audience);
        realtime.publish(RealtimeMessage.of("refund.status-changed", "BOOKING", payment.getBookingId().toString(),
                Map.of("refundId", refund.getId().toString(), "paymentId", payment.getId().toString(),
                        "status", refund.getStatus().name(), "amount", refund.getAmount().toPlainString())),
                audience);
    }
}
