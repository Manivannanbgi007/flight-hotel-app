package com.flighthotel.payment.service;

import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.payment.config.PaymentProperties;
import com.flighthotel.payment.config.PaymentProviders;
import com.flighthotel.payment.entity.PaymentTransaction;
import com.flighthotel.payment.entity.Refund;
import com.flighthotel.payment.provider.PaymentProvider;
import com.flighthotel.payment.provider.PaymentProvider.PaymentState;
import com.flighthotel.payment.provider.PaymentProvider.ProviderPayment;
import com.flighthotel.payment.provider.PaymentProvider.ProviderRefund;
import com.flighthotel.payment.repository.PaymentTransactionRepository;
import com.flighthotel.payment.repository.RefundRepository;

/**
 * Closes the gaps when the browser tab was closed or a webhook was lost (PAYMENT_INTEGRATION.md section 6): payments
 * and refunds that are still open after a while are looked up at the provider and the right event is published.
 * One payment or refund per transaction, with a row lock, so several instances can run the job together.
 */
@Service
public class ReconciliationService {

    private static final Logger log = LoggerFactory.getLogger(ReconciliationService.class);

    private final PaymentTransactionRepository payments;
    private final RefundRepository refunds;
    private final PaymentProviders providers;
    private final PaymentService paymentService;
    private final RefundService refundService;
    private final PaymentProperties properties;
    private final Clock clock;

    public ReconciliationService(PaymentTransactionRepository payments, RefundRepository refunds,
            PaymentProviders providers, PaymentService paymentService, RefundService refundService,
            PaymentProperties properties, Clock clock) {
        this.payments = payments;
        this.refunds = refunds;
        this.providers = providers;
        this.paymentService = paymentService;
        this.refundService = refundService;
        this.properties = properties;
        this.clock = clock;
    }

    /** @return true when the payment changed */
    @Transactional
    public boolean reconcilePayment(UUID paymentId) {
        PaymentTransaction payment = payments.lockById(paymentId).orElse(null);
        if (payment == null || !payment.getStatus().isOpen()) {
            return false;
        }
        PaymentProvider provider = providers.find(payment.getProvider()).orElse(null);
        if (provider == null) {
            return false;
        }
        ProviderPayment found = null;
        if (payment.getProviderPaymentId() != null) {
            found = provider.fetchPayment(payment.getProviderPaymentId());
        } else {
            List<ProviderPayment> attempts = provider.fetchOrderPayments(payment.getProviderOrderId());
            // A captured payment wins over the others; otherwise the latest attempt tells the story.
            found = attempts.stream().filter(p -> p.state() == PaymentState.CAPTURED).findFirst()
                    .orElseGet(() -> attempts.stream().max(Comparator.comparing(ProviderPayment::paymentId)).orElse(null));
        }
        if (found != null) {
            var before = payment.getStatus();
            paymentService.apply(payment, found);
            return payment.getStatus() != before;
        }
        Instant abandonedBefore = clock.instant().minus(properties.reconciliation().abandonAfter());
        if (payment.getCreatedAt().isBefore(abandonedBefore)) {
            paymentService.abandon(payment);
            log.info("Abandoned payment order closed paymentId={}", payment.getId());
            return true;
        }
        return false;
    }

    /** @return true when the refund changed */
    @Transactional
    public boolean reconcileRefund(UUID refundId) {
        Refund refund = refunds.lockById(refundId).orElse(null);
        if (refund == null || !refund.isPending() || refund.getProviderRefundId() == null) {
            return false;
        }
        PaymentTransaction payment = payments.lockById(refund.getPaymentId()).orElseThrow();
        PaymentProvider provider = providers.find(payment.getProvider()).orElse(null);
        if (provider == null) {
            return false;
        }
        ProviderRefund providerRefund = provider.fetchRefund(refund.getProviderRefundId());
        refundService.applyProviderRefund(refund, payment, providerRefund);
        return !refund.isPending();
    }
}
