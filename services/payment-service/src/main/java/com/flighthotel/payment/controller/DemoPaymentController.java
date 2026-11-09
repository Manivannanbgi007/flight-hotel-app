package com.flighthotel.payment.controller;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.payment.config.PaymentProviders;
import com.flighthotel.payment.dto.PaymentDtos.DemoOrderRequest;
import com.flighthotel.payment.entity.PaymentTransaction;
import com.flighthotel.payment.provider.DemoPaymentProvider;
import com.flighthotel.payment.provider.DemoPaymentProvider.DemoCheckout;
import com.flighthotel.payment.repository.PaymentTransactionRepository;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/**
 * The buttons of the labelled "Demo payment" page. Only exists when {@code payment.demo.enabled=true} (local and
 * Docker), never in production. It plays the role of the provider's checkout: it returns a payment id and the signed
 * callback, which the page then sends to {@code /api/payments/verify} like a real checkout would.
 */
@RestController
@RequestMapping("/api/payments/demo")
@ConditionalOnProperty(name = "payment.demo.enabled", havingValue = "true")
@Tag(name = "Demo payment", description = "Pay / Fail buttons of the DEMO provider (not available in production)")
public class DemoPaymentController {

    private final PaymentProviders providers;
    private final PaymentTransactionRepository payments;

    public DemoPaymentController(PaymentProviders providers, PaymentTransactionRepository payments) {
        this.providers = providers;
        this.payments = payments;
    }

    @PostMapping("/pay")
    @Operation(summary = "Demo: the customer pressed Pay")
    public DemoCheckout pay(@Valid @RequestBody DemoOrderRequest request) {
        return checkout(request.orderId(), true);
    }

    @PostMapping("/fail")
    @Operation(summary = "Demo: the customer pressed Fail")
    public DemoCheckout fail(@Valid @RequestBody DemoOrderRequest request) {
        return checkout(request.orderId(), false);
    }

    private DemoCheckout checkout(String orderId, boolean success) {
        PaymentTransaction payment = payments.findByProviderOrderId(orderId).orElse(null);
        if (payment == null || !payment.getUserId().equals(CurrentUser.require().id())) {
            throw new ResourceNotFoundException("Payment", orderId);
        }
        if (!DemoPaymentProvider.CODE.equals(payment.getProvider())) {
            throw new ApiException(HttpStatus.CONFLICT, "NOT_A_DEMO_PAYMENT", "This order is not a demo payment.");
        }
        return ((DemoPaymentProvider) providers.byCode(DemoPaymentProvider.CODE)).checkout(orderId, success);
    }
}
