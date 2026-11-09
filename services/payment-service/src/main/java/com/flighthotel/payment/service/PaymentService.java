package com.flighthotel.payment.service;

import java.time.Clock;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.security.Roles;
import com.flighthotel.payment.config.PaymentProviders;
import com.flighthotel.payment.dto.PaymentDtos.OrderResponse;
import com.flighthotel.payment.dto.PaymentDtos.PaymentResult;
import com.flighthotel.payment.entity.PayableBooking;
import com.flighthotel.payment.entity.PayableStatus;
import com.flighthotel.payment.entity.PaymentStatus;
import com.flighthotel.payment.entity.PaymentTransaction;
import com.flighthotel.payment.provider.PaymentProvider;
import com.flighthotel.payment.provider.PaymentProvider.PaymentState;
import com.flighthotel.payment.provider.PaymentProvider.ProviderOrder;
import com.flighthotel.payment.provider.PaymentProvider.ProviderPayment;
import com.flighthotel.payment.provider.ProviderException;
import com.flighthotel.payment.provider.RazorpayPaymentProvider;
import com.flighthotel.payment.repository.PayableBookingRepository;
import com.flighthotel.payment.repository.PaymentTransactionRepository;

/**
 * Taking the customer's money (PAYMENT_INTEGRATION.md section 3): create the order for the amount the server knows,
 * check what the browser reports, and apply what the provider says. The browser is never trusted: a payment only
 * counts when the signature is right and the provider itself confirms it.
 */
@Service
public class PaymentService {

    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);
    private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("^[A-Za-z0-9_-]{8,100}$");

    private final PayableBookingRepository payables;
    private final PaymentTransactionRepository payments;
    private final PaymentProviders providers;
    private final PaymentEvents events;
    private final RealtimePublisher realtime;
    private final Clock clock;

    public PaymentService(PayableBookingRepository payables, PaymentTransactionRepository payments,
            PaymentProviders providers, PaymentEvents events, RealtimePublisher realtime, Clock clock) {
        this.payables = payables;
        this.payments = payments;
        this.providers = providers;
        this.events = events;
        this.realtime = realtime;
        this.clock = clock;
    }

    // ================================================================== customer calls

    /**
     * The order the customer pays. The same Idempotency-Key returns the same order, and a booking has only one open
     * order at a time, so a double click or a second tab never creates a second charge.
     */
    @PreAuthorize("isAuthenticated()")
    @Transactional
    public OrderResponse createOrder(UUID bookingId, String idempotencyKey) {
        AuthenticatedUser user = CurrentUser.require();
        String key = requireKey(idempotencyKey);
        PayableBooking known = payables.lockById(bookingId).orElse(null);
        if (known == null) {
            // booking-service shows "waiting for payment" a moment before this service has received the event
            // (separate databases, linked by Kafka): the page simply asks again. Reveals nothing about other bookings.
            throw new ConflictException("PAYMENT_NOT_READY", "We are preparing your payment. Please try again in a moment.");
        }
        PayableBooking payable = Optional.of(known).filter(p -> p.getUserId().equals(user.id()))
                .orElseThrow(() -> new ResourceNotFoundException("Booking", bookingId));

        PaymentTransaction repeated = payments.findByUserIdAndIdempotencyKey(user.id(), key).orElse(null);
        if (repeated != null) {
            if (!repeated.getBookingId().equals(bookingId)) {
                throw new BusinessRuleException("IDEMPOTENCY_KEY_REUSED",
                        "This Idempotency-Key was already used for a different payment.");
            }
            return order(repeated, payable);
        }
        if (payable.getStatus() == PayableStatus.PAID || hasPaidPayment(bookingId)) {
            throw new ConflictException("BOOKING_ALREADY_PAID", "This booking is already paid.");
        }
        PaymentTransaction open = payments.findFirstByBookingIdAndStatusInOrderByCreatedAtDesc(bookingId,
                EnumSet.of(PaymentStatus.INITIATED, PaymentStatus.PENDING)).orElse(null);
        if (open != null) {
            return order(open, payable);
        }
        Instant now = clock.instant();
        if (!payable.acceptsNewOrder(now)) {
            throw new ConflictException("PAYMENT_WINDOW_CLOSED",
                    "The time to pay for this booking is over. Please search and book again.");
        }

        PaymentProvider provider = providers.active();
        ProviderOrder providerOrder;
        try {
            providerOrder = provider.createOrder(payable.getAmount(), payable.getCurrency(),
                    payable.getBookingReference(), key);
        } catch (ProviderException ex) {
            log.error("Could not create the provider order bookingId={} provider={} error={}", bookingId,
                    provider.code(), ex.getMessage());
            throw new ApiException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_UNAVAILABLE",
                    "The payment service is not available right now. Please try again in a moment.");
        }
        PaymentTransaction payment = payments.save(new PaymentTransaction(bookingId, user.id(), provider.code(),
                providerOrder.orderId(), payable.getAmount(), payable.getCurrency(), key));
        log.info("Payment order created paymentId={} bookingId={} provider={} amount={}", payment.getId(), bookingId,
                provider.code(), payment.getAmount());
        return order(payment, payable);
    }

    /** The browser's callback after checkout. Signature first, then the provider's own record of the payment. */
    @PreAuthorize("isAuthenticated()")
    @Transactional
    public PaymentResult verify(String providerOrderId, String providerPaymentId, String signature) {
        PaymentTransaction payment = ownLocked(providerOrderId);
        PaymentProvider provider = providers.byCode(payment.getProvider());
        if (!provider.verifyCheckoutSignature(providerOrderId, providerPaymentId, signature)) {
            log.warn("Invalid checkout signature paymentId={} orderId={}", payment.getId(), providerOrderId);
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PAYMENT_SIGNATURE",
                    "The payment could not be verified. If money was taken, it will be refunded automatically.");
        }
        if (payment.getStatus().isPaid() && providerPaymentId.equals(payment.getProviderPaymentId())) {
            return result(payment);
        }
        ProviderPayment fetched;
        try {
            fetched = provider.fetchPayment(providerPaymentId);
        } catch (ProviderException ex) {
            if (ex.isRejected()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PAYMENT",
                        "The payment could not be found at the payment provider.");
            }
            // The provider cannot be asked right now: remember the payment; the reconciliation job decides later.
            log.warn("Provider unavailable while verifying paymentId={} error={}", payment.getId(), ex.getMessage());
            payment.pending(providerPaymentId, null);
            return result(payment);
        }
        if (fetched.orderId() != null && !fetched.orderId().equals(payment.getProviderOrderId())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PAYMENT_ORDER_MISMATCH",
                    "This payment belongs to a different order.");
        }
        apply(payment, fetched);
        return result(payment);
    }

    /**
     * Razorpay Checkout told the browser that a payment failed. Only the provider's own record counts: if it says
     * failed, the attempt is closed so the customer can start a new one.
     */
    @PreAuthorize("isAuthenticated()")
    @Transactional
    public PaymentResult reportFailure(String providerOrderId, String providerPaymentId) {
        PaymentTransaction payment = ownLocked(providerOrderId);
        if (payment.getStatus().isOpen()) {
            try {
                ProviderPayment fetched = providers.byCode(payment.getProvider()).fetchPayment(providerPaymentId);
                if (fetched.state() == PaymentState.FAILED
                        && (fetched.orderId() == null || fetched.orderId().equals(payment.getProviderOrderId()))) {
                    apply(payment, fetched);
                }
            } catch (ProviderException ex) {
                log.info("Failure report could not be checked paymentId={} error={}", payment.getId(), ex.getMessage());
            }
        }
        return result(payment);
    }

    // ================================================================== applying the provider's truth

    /**
     * Brings the payment in line with what the provider says (checkout callback, webhook or reconciliation).
     * Repeating it is harmless. The caller holds the row lock.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void apply(PaymentTransaction payment, ProviderPayment provider) {
        Instant now = clock.instant();
        switch (provider.state()) {
            case CAPTURED -> {
                if (payment.getStatus().isPaid()) {
                    if (!provider.paymentId().equals(payment.getProviderPaymentId())) {
                        log.warn("Another payment on an already paid order paymentId={} other={}", payment.getId(),
                                provider.paymentId());
                    }
                    return;
                }
                if (provider.amount() != null && provider.amount().compareTo(payment.getAmount()) != 0
                        || provider.currency() != null && !provider.currency().equals(payment.getCurrency())) {
                    // Captured for another amount than the order: never confirm the booking, a person must look.
                    payment.flag("AMOUNT_MISMATCH", "Provider captured " + provider.amount() + " "
                            + provider.currency() + " for an order of " + payment.getAmount());
                    log.error("MANUAL REVIEW: captured amount differs paymentId={} order={} captured={} expected={}",
                            payment.getId(), payment.getProviderOrderId(), provider.amount(), payment.getAmount());
                    return;
                }
                // A failed attempt on an order may be followed by a successful one (checkout retry): that counts.
                payment.succeeded(provider.paymentId(), provider.method(), now);
                payables.findById(payment.getBookingId()).ifPresent(PayableBooking::paid);
                events.succeeded(payment, now);
                notifyCustomer(payment);
                log.info("Payment succeeded paymentId={} bookingId={}", payment.getId(), payment.getBookingId());
            }
            case FAILED -> {
                if (payment.getStatus() == PaymentStatus.FAILED || payment.getStatus().isPaid()) {
                    return;
                }
                payment.failed(provider.paymentId(), provider.errorCode(), provider.errorDescription());
                events.failed(payment, now);
                notifyCustomer(payment);
                log.info("Payment failed paymentId={} bookingId={} code={}", payment.getId(), payment.getBookingId(),
                        payment.getFailureCode());
            }
            case PENDING -> {
                if (payment.getStatus().isOpen() && provider.paymentId() != null) {
                    payment.pending(provider.paymentId(), provider.method());
                }
            }
        }
    }

    /** An abandoned order (the customer never paid): closed quietly, nothing to tell the booking. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void abandon(PaymentTransaction payment) {
        payment.failed(null, "ABANDONED", "The payment was not completed.");
        notifyCustomer(payment);
    }

    // ================================================================== helpers

    PaymentTransaction ownLocked(String providerOrderId) {
        AuthenticatedUser user = CurrentUser.require();
        PaymentTransaction payment = payments.lockByProviderOrderId(providerOrderId)
                .orElseThrow(() -> new ResourceNotFoundException("Payment", providerOrderId));
        if (!payment.getUserId().equals(user.id())) {
            throw new ResourceNotFoundException("Payment", providerOrderId);
        }
        return payment;
    }

    private boolean hasPaidPayment(UUID bookingId) {
        return payments.findByBookingIdOrderByCreatedAtDesc(bookingId).stream()
                .anyMatch(payment -> payment.getStatus().isPaid());
    }

    private OrderResponse order(PaymentTransaction payment, PayableBooking payable) {
        PaymentProvider provider = providers.byCode(payment.getProvider());
        String keyId = provider instanceof RazorpayPaymentProvider razorpay ? razorpay.keyId() : null;
        return new OrderResponse(payment.getId(), payment.getBookingId(), payable.getBookingReference(),
                payment.getProvider(), payment.getProviderOrderId(), keyId, payment.getAmount(),
                payment.getCurrency(), payable.getDescription(), payable.getContactEmail(),
                payable.getPaymentDeadline(), payment.getStatus().name());
    }

    static PaymentResult result(PaymentTransaction payment) {
        return new PaymentResult(payment.getId(), payment.getBookingId(), payment.getStatus().name(),
                payment.getMethod(), payment.getAmount(), payment.getCurrency(), payment.getFailureCode(),
                payment.getFailureMessage());
    }

    private void notifyCustomer(PaymentTransaction payment) {
        realtime.publish(RealtimeMessage.of("payment.status-changed", "PAYMENT", payment.getBookingId().toString(),
                        Map.of("paymentId", payment.getId().toString(), "status", payment.getStatus().name())),
                RealtimeAudience.user(payment.getUserId()).andRoles(Roles.ADMIN, Roles.SUPPORT_AGENT));
    }

    private static String requireKey(String key) {
        if (key == null || key.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED",
                    "The Idempotency-Key header is required.");
        }
        if (!IDEMPOTENCY_KEY.matcher(key).matches()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY",
                    "The Idempotency-Key must be 8-100 letters, digits, '-' or '_'.");
        }
        return key;
    }
}
