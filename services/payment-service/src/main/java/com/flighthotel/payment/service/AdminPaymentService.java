package com.flighthotel.payment.service;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.payment.entity.Invoice;
import com.flighthotel.payment.entity.PayableBooking;
import com.flighthotel.payment.entity.PaymentStatus;
import com.flighthotel.payment.entity.PaymentTransaction;
import com.flighthotel.payment.entity.Refund;
import com.flighthotel.payment.repository.InvoiceRepository;
import com.flighthotel.payment.repository.PayableBookingRepository;
import com.flighthotel.payment.repository.PaymentTransactionRepository;
import com.flighthotel.payment.repository.RefundRepository;

import jakarta.persistence.criteria.Predicate;

/**
 * The admin portal's payment and refund lists, the figures above the payment list and the details of one payment
 * (API_DOCUMENTATION.md section 14.3). Read only: refunds are always started from the booking (cancellation, retry,
 * goodwill refund), never here.
 */
@Service
@Transactional(readOnly = true)
public class AdminPaymentService {

        private final PaymentTransactionRepository payments;
    private final RefundRepository refunds;
    private final PayableBookingRepository payables;
    private final InvoiceRepository invoices;
    private final PaymentSearch search;

    public AdminPaymentService(PaymentTransactionRepository payments, RefundRepository refunds,
            PayableBookingRepository payables, InvoiceRepository invoices, PaymentSearch search) {
        this.payments = payments;
        this.refunds = refunds;
        this.payables = payables;
        this.invoices = invoices;
        this.search = search;
    }

    public record AdminPaymentRow(UUID id, UUID bookingId, String bookingReference, String bookingType,
            String description, String provider, BigDecimal amount, BigDecimal refundedAmount, String currency,
            String status, String method, String failureCode, String failureMessage, Instant createdAt,
            Instant verifiedAt, String invoiceNumber, UUID userId, String contactEmail, String providerPaymentId,
            String providerOrderId) {
    }

    public record RefundView(UUID id, UUID paymentId, UUID bookingId, String bookingReference, BigDecimal amount,
            String currency, String status, String reason, String providerRefundId, String failureReason,
            Instant createdAt, Instant updatedAt) {
    }

    /** One payment with its refunds; {@code providerPaymentId} etc. for the support and admin view. */
    public record PaymentDetails(UUID id, UUID bookingId, String bookingReference, String bookingType,
            String description, String provider, BigDecimal amount, BigDecimal refundedAmount, String currency,
            String status, String method, String failureCode, String failureMessage, Instant createdAt,
            Instant verifiedAt, String invoiceNumber, String providerPaymentId, String contactEmail,
            List<RefundView> refunds) {
    }

    /**
     * The figures above the payments list, for the same filters as the list. {@code successful} counts captured
     * payments (also those refunded since), {@code pending} the attempts that are still open.
     */
    public record PaymentSummary(long total, long successful, long failed, long pending, BigDecimal collectedAmount,
            BigDecimal refundedAmount, String currency) {
    }

    /**
     * {@code query}: a booking reference, a payment id, the provider's payment or order id, or the customer's e-mail
     * (all exact). {@code method} (card, upi, ...) and {@code bookingType} (HOTEL or FLIGHT) filter too. Days are India
     * days, both inclusive; {@code sort=createdAt|amount[,asc|desc]}, newest first by default.
     */
    @PreAuthorize("hasAuthority('PAYMENT_READ_ANY')")
    public PageResponse<AdminPaymentRow> payments(String query, PaymentStatus status, String provider, String method,
            String bookingType, LocalDate from, LocalDate to, int page, int size, String sort) {
        PaymentSearch.Filter filter = search.filter(query, status, provider, method, bookingType, from, to);
        Page<PaymentTransaction> found = payments.findAll(search.specification(filter, null),
                PageRequest.of(Math.max(page, 0), Math.clamp(size, 1, 100),
                        PaymentSearch.sortOf(sort, Map.of("createdAt", "createdAt", "amount", "amount"))));
        Map<UUID, PayableBooking> bookings = bookings(found.getContent().stream()
                .map(PaymentTransaction::getBookingId).toList());
        Map<UUID, Invoice> billed = invoices.findByBookingIdIn(bookings.keySet()).stream()
                .collect(Collectors.toMap(Invoice::getBookingId, Function.identity()));
        return PageResponse.from(found, payment -> {
            PayableBooking booking = bookings.get(payment.getBookingId());
            Invoice invoice = billed.get(payment.getBookingId());
            return new AdminPaymentRow(payment.getId(), payment.getBookingId(),
                    booking == null ? null : booking.getBookingReference(),
                    booking == null ? null : booking.getBookingType(),
                    booking == null ? null : booking.getDescription(), payment.getProvider(), payment.getAmount(),
                    payment.getRefundedAmount(), payment.getCurrency(), payment.getStatus().name(),
                    payment.getMethod(), payment.getFailureCode(), payment.getFailureMessage(), payment.getCreatedAt(),
                    payment.getVerifiedAt(), invoice != null && invoice.getPaymentId().equals(payment.getId())
                            ? invoice.getInvoiceNumber() : null,
                    payment.getUserId(), booking == null ? null : booking.getContactEmail(),
                    payment.getProviderPaymentId(), payment.getProviderOrderId());
        });
    }

    /** Counts and money for the same filters as {@link #payments}: one grouped query in the database. */
    @PreAuthorize("hasAuthority('PAYMENT_READ_ANY')")
    public PaymentSummary summary(String query, PaymentStatus status, String provider, String method,
            String bookingType, LocalDate from, LocalDate to) {
        PaymentSearch.Totals totals = search.totals(
                search.filter(query, status, provider, method, bookingType, from, to), null);
        return new PaymentSummary(totals.total(), totals.successful(), totals.failed(), totals.pending(),
                totals.collected(), totals.refunded(), "INR");
    }

    /** The owner, or support and admins ({@code PAYMENT_READ_ANY}); anyone else gets 404 (never reveal it exists). */
    @PreAuthorize("isAuthenticated()")
    public PaymentDetails payment(UUID paymentId) {
        AuthenticatedUser user = CurrentUser.require();
        PaymentTransaction payment = payments.findById(paymentId)
                .filter(found -> found.getUserId().equals(user.id())
                        || user.hasPermission(PaymentQueryService.READ_ANY))
                .orElseThrow(() -> new ResourceNotFoundException("Payment", paymentId));
        PayableBooking booking = payables.findById(payment.getBookingId()).orElse(null);
        String invoiceNumber = invoices.findByBookingId(payment.getBookingId())
                .filter(invoice -> invoice.getPaymentId().equals(paymentId)).map(Invoice::getInvoiceNumber)
                .orElse(null);
        String reference = booking == null ? null : booking.getBookingReference();
        List<RefundView> list = refunds.findByPaymentIdOrderByCreatedAt(paymentId).stream()
                .map(refund -> view(refund, reference)).toList();
        return new PaymentDetails(payment.getId(), payment.getBookingId(), reference,
                booking == null ? null : booking.getBookingType(), booking == null ? null : booking.getDescription(),
                payment.getProvider(), payment.getAmount(), payment.getRefundedAmount(), payment.getCurrency(),
                payment.getStatus().name(), payment.getMethod(), payment.getFailureCode(), payment.getFailureMessage(),
                payment.getCreatedAt(), payment.getVerifiedAt(), invoiceNumber, payment.getProviderPaymentId(),
                booking == null ? null : booking.getContactEmail(), list);
    }

    /** {@code query}: a booking reference, refund id or payment id (exact). Newest first. */
    @PreAuthorize("hasAuthority('PAYMENT_READ_ANY')")
    public PageResponse<RefundView> refunds(String query, Refund.Status status, LocalDate from, LocalDate to,
            int page, int size) {
        Instant[] range = PaymentSearch.range(from, to);
        UUID byBooking = search.bookingIdOf(query);
        String text = query == null ? "" : query.strip();
        Specification<Refund> filter = (root, criteria, cb) -> {
            List<Predicate> where = new ArrayList<>();
            if (!text.isEmpty()) {
                List<Predicate> any = new ArrayList<>();
                any.add(cb.equal(root.get("providerRefundId"), text));
                PaymentSearch.uuid(text).ifPresent(id -> {
                    any.add(cb.equal(root.get("id"), id));
                    any.add(cb.equal(root.get("paymentId"), id));
                });
                if (byBooking != null) {
                    any.add(cb.equal(root.get("bookingId"), byBooking));
                }
                where.add(cb.or(any.toArray(Predicate[]::new)));
            }
            if (status != null) {
                where.add(cb.equal(root.get("status"), status));
            }
            PaymentSearch.addRange(where, cb, root.get("createdAt"), range);
            return cb.and(where.toArray(Predicate[]::new));
        };
        Page<Refund> found = refunds.findAll(filter, PageRequest.of(Math.max(page, 0), Math.clamp(size, 1, 100),
                Sort.by(Sort.Direction.DESC, "createdAt").and(Sort.by(Sort.Direction.DESC, "id"))));
        Map<UUID, PayableBooking> bookings = bookings(found.getContent().stream().map(Refund::getBookingId).toList());
        return PageResponse.from(found, refund -> view(refund, bookings.containsKey(refund.getBookingId())
                ? bookings.get(refund.getBookingId()).getBookingReference() : null));
    }

    // ------------------------------------------------------------------ helpers

    private static RefundView view(Refund refund, String bookingReference) {
        return new RefundView(refund.getId(), refund.getPaymentId(), refund.getBookingId(), bookingReference,
                refund.getAmount(), refund.getCurrency(), refund.getStatus().name(), refund.getReason(),
                refund.getProviderRefundId(), refund.getFailureReason(), refund.getCreatedAt(), refund.getUpdatedAt());
    }

    private Map<UUID, PayableBooking> bookings(Collection<UUID> ids) {
        return payables.findAllById(ids.stream().distinct().toList()).stream()
                .collect(Collectors.toMap(PayableBooking::getBookingId, Function.identity()));
    }
}
