package com.flighthotel.payment.service;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.payment.config.PaymentProviders;
import com.flighthotel.payment.entity.PaymentTransaction;
import com.flighthotel.payment.entity.Refund;
import com.flighthotel.payment.entity.WebhookEvent;
import com.flighthotel.payment.provider.DemoPaymentProvider;
import com.flighthotel.payment.provider.PaymentProvider;
import com.flighthotel.payment.provider.PaymentProvider.ProviderPayment;
import com.flighthotel.payment.provider.PaymentProvider.ProviderRefund;
import com.flighthotel.payment.provider.RazorpayPaymentProvider;
import com.flighthotel.payment.repository.PaymentTransactionRepository;
import com.flighthotel.payment.repository.RefundRepository;
import com.flighthotel.payment.repository.WebhookEventRepository;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The provider's webhooks (PAYMENT_INTEGRATION.md section 3, rules 2 to 4): the signature over the raw bytes is
 * checked before anything is parsed, a repeated event id is acknowledged and ignored, and only a small summary of
 * the event is stored (ids, amounts, status; never e-mail, phone or instrument data).
 */
@Service
public class WebhookService {

    public enum Outcome { PROCESSED, IGNORED, DUPLICATE }

    private static final Logger log = LoggerFactory.getLogger(WebhookService.class);

    private final PaymentProviders providers;
    private final PaymentTransactionRepository payments;
    private final RefundRepository refunds;
    private final WebhookEventRepository webhookEvents;
    private final PaymentService paymentService;
    private final RefundService refundService;
    private final JsonMapper json;
    private final Clock clock;

    public WebhookService(PaymentProviders providers, PaymentTransactionRepository payments, RefundRepository refunds,
            WebhookEventRepository webhookEvents, PaymentService paymentService, RefundService refundService,
            JsonMapper json, Clock clock) {
        this.providers = providers;
        this.payments = payments;
        this.refunds = refunds;
        this.webhookEvents = webhookEvents;
        this.paymentService = paymentService;
        this.refundService = refundService;
        this.json = json;
        this.clock = clock;
    }

    @Transactional
    public Outcome handle(byte[] rawBody, String signature, String eventId) {
        PaymentProvider provider = providers.find(RazorpayPaymentProvider.CODE)
                .or(() -> providers.find(DemoPaymentProvider.CODE)).orElseThrow();
        // 1. Authenticity first, on the raw bytes. Nothing from an unsigned body is parsed or stored.
        if (!provider.verifyWebhookSignature(rawBody, signature)) {
            log.warn("Webhook with an invalid signature rejected");
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_WEBHOOK_SIGNATURE", "Invalid signature.");
        }
        if (eventId == null || eventId.isBlank() || eventId.length() > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WEBHOOK_EVENT_ID_MISSING", "The event id header is missing.");
        }
        // 2. Each event id once.
        if (webhookEvents.existsByProviderAndProviderEventId(provider.code(), eventId)) {
            log.info("Duplicate webhook ignored eventId={}", eventId);
            return Outcome.DUPLICATE;
        }
        JsonNode body;
        try {
            body = json.readTree(rawBody);
        } catch (RuntimeException ex) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_WEBHOOK_BODY", "The body is not valid JSON.");
        }
        String type = body.path("event").asString("unknown");
        Instant now = clock.instant();
        JsonNode paymentNode = body.path("payload").path("payment").path("entity");
        JsonNode refundNode = body.path("payload").path("refund").path("entity");
        WebhookEvent record = webhookEvents.save(new WebhookEvent(provider.code(), eventId, type,
                summary(type, paymentNode, refundNode), now));

        Outcome outcome = switch (type) {
            case "payment.captured", "order.paid", "payment.failed", "payment.authorized" ->
                    paymentNode.isMissingNode() ? Outcome.IGNORED : payment(paymentNode);
            case "refund.processed", "refund.failed" -> refundNode.isMissingNode() ? Outcome.IGNORED : refund(refundNode);
            default -> Outcome.IGNORED;
        };
        record.done(outcome == Outcome.PROCESSED ? WebhookEvent.PROCESSED : WebhookEvent.IGNORED, clock.instant());
        log.info("Webhook handled type={} eventId={} outcome={}", type, eventId, outcome);
        return outcome;
    }

    private Outcome payment(JsonNode node) {
        ProviderPayment providerPayment = RazorpayPaymentProvider.payment(node);
        if (providerPayment.orderId() == null) {
            return Outcome.IGNORED;
        }
        PaymentTransaction payment = payments.lockByProviderOrderId(providerPayment.orderId()).orElse(null);
        if (payment == null) {
            log.warn("Webhook for an unknown order orderId={}", providerPayment.orderId());
            return Outcome.IGNORED;
        }
        paymentService.apply(payment, providerPayment);
        return Outcome.PROCESSED;
    }

    private Outcome refund(JsonNode node) {
        ProviderRefund providerRefund = RazorpayPaymentProvider.refund(node);
        Refund refund = refunds.lockByProviderRefundId(providerRefund.refundId()).orElse(null);
        if (refund == null) {
            log.warn("Webhook for an unknown refund refundId={}", providerRefund.refundId());
            return Outcome.IGNORED;
        }
        PaymentTransaction payment = payments.lockById(refund.getPaymentId()).orElseThrow();
        refundService.applyProviderRefund(refund, payment, providerRefund);
        return Outcome.PROCESSED;
    }

    private String summary(String type, JsonNode payment, JsonNode refund) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("event", type);
        put(summary, "orderId", payment.path("order_id"));
        put(summary, "paymentId", payment.isMissingNode() ? refund.path("payment_id") : payment.path("id"));
        put(summary, "refundId", refund.path("id"));
        put(summary, "amount", payment.isMissingNode() ? refund.path("amount") : payment.path("amount"));
        put(summary, "status", payment.isMissingNode() ? refund.path("status") : payment.path("status"));
        put(summary, "method", payment.path("method"));
        return json.writeValueAsString(summary);
    }

    private static void put(Map<String, Object> target, String name, JsonNode value) {
        if (!value.isMissingNode() && !value.isNull()) {
            target.put(name, value.isNumber() ? value.numberValue() : value.asString());
        }
    }
}
