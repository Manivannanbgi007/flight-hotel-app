package com.flighthotel.payment.controller;

import java.util.Map;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.payment.service.WebhookService;
import com.flighthotel.payment.service.WebhookService.Outcome;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * Where the payment provider reports payments and refunds. Public (no login; the provider has none) but protected
 * by the signature of the raw body, a rate limit at the gateway and the unique event id.
 */
@RestController
@RequestMapping("/api/payments/webhook")
@Tag(name = "Payment webhook", description = "Called by the payment provider, signed")
public class WebhookController {

    private final WebhookService webhooks;

    public WebhookController(WebhookService webhooks) {
        this.webhooks = webhooks;
    }

    /** The body is taken as raw bytes: the signature covers exactly these bytes. */
    @PostMapping(consumes = "*/*")
    @Operation(summary = "Provider webhook (Razorpay: X-Razorpay-Signature and X-Razorpay-Event-Id headers)")
    public ResponseEntity<Map<String, String>> receive(@RequestBody byte[] rawBody,
            @RequestHeader(name = "X-Razorpay-Signature", required = false) String signature,
            @RequestHeader(name = "X-Razorpay-Event-Id", required = false) String eventId) {
        Outcome outcome;
        try {
            outcome = webhooks.handle(rawBody, signature, eventId);
        } catch (DataIntegrityViolationException sameEventAtTheSameTime) {
            outcome = Outcome.DUPLICATE;
        }
        // 200 for everything that was authentic: the provider stops retrying; unknown events are simply ignored.
        return ResponseEntity.ok(Map.of("status", outcome.name()));
    }
}
