package com.flighthotel.payment.scheduler;

import java.time.Clock;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;
import java.util.function.Predicate;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.flighthotel.payment.config.PaymentProperties;
import com.flighthotel.payment.entity.PaymentStatus;
import com.flighthotel.payment.repository.PaymentTransactionRepository;
import com.flighthotel.payment.repository.RefundRepository;
import com.flighthotel.payment.service.ReconciliationService;

/** PAYMENT_INTEGRATION.md section 6: every 5 minutes, ask the provider about payments and refunds still open. */
@Component
public class ReconciliationJob {

    private static final Logger log = LoggerFactory.getLogger(ReconciliationJob.class);
    private static final int BATCH = 100;

    private final PaymentTransactionRepository payments;
    private final RefundRepository refunds;
    private final ReconciliationService reconciliation;
    private final PaymentProperties properties;
    private final Clock clock;

    public ReconciliationJob(PaymentTransactionRepository payments, RefundRepository refunds,
            ReconciliationService reconciliation, PaymentProperties properties, Clock clock) {
        this.payments = payments;
        this.refunds = refunds;
        this.reconciliation = reconciliation;
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${payment.jobs.reconcile-interval:5m}", initialDelayString = "PT1M")
    public void reconcile() {
        run("payments reconciled", payments.findIdsByStatusInCreatedBefore(
                EnumSet.of(PaymentStatus.INITIATED, PaymentStatus.PENDING),
                clock.instant().minus(properties.reconciliation().paymentAfter()), PageRequest.ofSize(BATCH)),
                reconciliation::reconcilePayment);
        run("refunds reconciled", refunds.findPendingIdsCreatedBefore(
                clock.instant().minus(properties.reconciliation().refundAfter()), PageRequest.ofSize(BATCH)),
                reconciliation::reconcileRefund);
    }

    private static void run(String what, List<UUID> ids, Predicate<UUID> action) {
        int done = 0;
        for (UUID id : ids) {
            try {
                if (action.test(id)) {
                    done++;
                }
            } catch (RuntimeException ex) {
                // E.g. the provider is down: the next run tries again.
                log.warn("Reconciliation failed for id={} error={}", id, ex.toString());
            }
        }
        if (done > 0) {
            log.info("Reconciliation job: {} {}", done, what);
        }
    }
}
