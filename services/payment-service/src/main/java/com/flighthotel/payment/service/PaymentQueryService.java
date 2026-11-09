package com.flighthotel.payment.service;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.payment.dto.PaymentDtos.InvoiceView;
import com.flighthotel.payment.dto.PaymentDtos.MyPaymentsSummary;
import com.flighthotel.payment.dto.PaymentDtos.PaymentSummary;
import com.flighthotel.payment.entity.Invoice;
import com.flighthotel.payment.entity.PayableBooking;
import com.flighthotel.payment.entity.PaymentStatus;
import com.flighthotel.payment.entity.PaymentTransaction;
import com.flighthotel.payment.repository.InvoiceRepository;
import com.flighthotel.payment.repository.PayableBookingRepository;
import com.flighthotel.payment.repository.PaymentTransactionRepository;

/** Payment History and invoices for the customer (own data only; support and admin may read any). */
@Service
@Transactional(readOnly = true)
public class PaymentQueryService {

    static final String READ_ANY = "PAYMENT_READ_ANY";

    private final PaymentTransactionRepository payments;
    private final PayableBookingRepository payables;
    private final InvoiceRepository invoices;
    private final PaymentSearch search;

    public PaymentQueryService(PaymentTransactionRepository payments, PayableBookingRepository payables,
            InvoiceRepository invoices, PaymentSearch search) {
        this.payments = payments;
        this.payables = payables;
        this.invoices = invoices;
        this.search = search;
    }

    /**
     * Payment History: the customer's own payment attempts, newest first by default. {@code query} finds a booking
     * reference, a payment id or the provider's payment or order id (exact); {@code status}, {@code method},
     * {@code bookingType} and the India days {@code from} / {@code to} filter; {@code sort=createdAt|amount[,asc|desc]}.
     * Whatever the filters say, only the caller's payments can match.
     */
    @PreAuthorize("isAuthenticated()")
    public PageResponse<PaymentSummary> myPayments(String query, PaymentStatus status, String method,
            String bookingType, LocalDate from, LocalDate to, String sort, int page, int size) {
        AuthenticatedUser user = CurrentUser.require();
        PaymentSearch.Filter filter = search.filter(query, status, null, method, bookingType, from, to);
        Page<PaymentTransaction> result = payments.findAll(search.specification(filter, user.id()),
                PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 50),
                        PaymentSearch.sortOf(sort, java.util.Map.of("createdAt", "createdAt", "amount", "amount"))));
        Map<UUID, PaymentSummary> byId = summaries(result.getContent());
        return PageResponse.from(result, payment -> byId.get(payment.getId()));
    }

    /** The figures above Payment History: the same filters as {@link #myPayments}, the caller's payments only. */
    @PreAuthorize("isAuthenticated()")
    public MyPaymentsSummary mySummary(String query, PaymentStatus status, String method, String bookingType,
            LocalDate from, LocalDate to) {
        AuthenticatedUser user = CurrentUser.require();
        PaymentSearch.Totals totals = search.totals(
                search.filter(query, status, null, method, bookingType, from, to), user.id());
        return new MyPaymentsSummary(totals.total(), totals.successful(), totals.failed(), totals.pending(),
                totals.collected(), totals.refunded(), "INR");
    }

    /** Every payment attempt of one booking (the payment result page and booking details). */
    @PreAuthorize("isAuthenticated()")
    public List<PaymentSummary> forBooking(UUID bookingId) {
        AuthenticatedUser user = CurrentUser.require();
        List<PaymentTransaction> list = payments.findByBookingIdOrderByCreatedAtDesc(bookingId);
        if (list.isEmpty() || !canRead(user, list.get(0).getUserId())) {
            if (list.isEmpty()) {
                return List.of();
            }
            throw new ResourceNotFoundException("Booking", bookingId);
        }
        Map<UUID, PaymentSummary> byId = summaries(list);
        return list.stream().map(payment -> byId.get(payment.getId())).toList();
    }

    @PreAuthorize("isAuthenticated()")
    public InvoiceView invoiceForBooking(UUID bookingId) {
        AuthenticatedUser user = CurrentUser.require();
        Invoice invoice = invoices.findByBookingId(bookingId)
                .filter(found -> canRead(user, found.getUserId()))
                .orElseThrow(() -> new ResourceNotFoundException("Invoice", bookingId));
        return view(invoice);
    }

    @PreAuthorize("isAuthenticated()")
    public PageResponse<InvoiceView> myInvoices(int page, int size) {
        AuthenticatedUser user = CurrentUser.require();
        return PageResponse.from(invoices.findByUserId(user.id(), PageRequest.of(Math.max(page, 0),
                Math.min(Math.max(size, 1), 50), Sort.by(Sort.Direction.DESC, "issuedAt"))), PaymentQueryService::view);
    }

    private Map<UUID, PaymentSummary> summaries(Collection<PaymentTransaction> list) {
        List<UUID> bookingIds = list.stream().map(PaymentTransaction::getBookingId).distinct().toList();
        Map<UUID, PayableBooking> bookings = payables.findAllById(bookingIds).stream()
                .collect(Collectors.toMap(PayableBooking::getBookingId, Function.identity()));
        Map<UUID, Invoice> invoiceByBooking = invoices.findByBookingIdIn(bookingIds).stream()
                .collect(Collectors.toMap(Invoice::getBookingId, Function.identity()));
        return list.stream().collect(Collectors.toMap(PaymentTransaction::getId, payment -> {
            PayableBooking booking = bookings.get(payment.getBookingId());
            Invoice invoice = invoiceByBooking.get(payment.getBookingId());
            boolean billed = invoice != null && invoice.getPaymentId().equals(payment.getId());
            return new PaymentSummary(payment.getId(), payment.getBookingId(),
                    booking == null ? null : booking.getBookingReference(),
                    booking == null ? null : booking.getDescription(), payment.getProvider(), payment.getAmount(),
                    payment.getRefundedAmount(), payment.getCurrency(), payment.getStatus().name(),
                    payment.getMethod(), payment.getFailureMessage(), payment.getCreatedAt(),
                    payment.getVerifiedAt(), billed ? invoice.getInvoiceNumber() : null,
                    booking == null ? null : booking.getBookingType());
        }));
    }

    static InvoiceView view(Invoice invoice) {
        return new InvoiceView(invoice.getId(), invoice.getInvoiceNumber(), invoice.getBookingId(),
                invoice.getBookingReference(), invoice.getPaymentId(), invoice.getBillingName(),
                invoice.getBillingEmail(), invoice.getDescription(), invoice.getCurrency(),
                invoice.getTaxableAmount(), invoice.getTaxAmount(), invoice.getDiscountAmount(),
                invoice.getTotalAmount(), invoice.getIssuedAt());
    }

    private static boolean canRead(AuthenticatedUser user, UUID ownerId) {
        return ownerId.equals(user.id()) || user.hasPermission(READ_ANY);
    }
}
