package com.flighthotel.payment.controller;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.payment.dto.PaymentDtos.CreateOrderRequest;
import com.flighthotel.payment.dto.PaymentDtos.FailureReport;
import com.flighthotel.payment.dto.PaymentDtos.InvoiceView;
import com.flighthotel.payment.dto.PaymentDtos.MyPaymentsSummary;
import com.flighthotel.payment.dto.PaymentDtos.OrderResponse;
import com.flighthotel.payment.dto.PaymentDtos.PaymentResult;
import com.flighthotel.payment.dto.PaymentDtos.PaymentSummary;
import com.flighthotel.payment.dto.PaymentDtos.VerifyRequest;
import com.flighthotel.payment.entity.PaymentStatus;
import com.flighthotel.payment.service.PaymentQueryService;
import com.flighthotel.payment.service.PaymentService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/** Paying for a booking, Payment History and invoices (logged-in customers; own data only). */
@RestController
@Tag(name = "Payments", description = "Create an order, verify the payment, Payment History, invoices")
public class PaymentController {

    private final PaymentService payments;
    private final PaymentQueryService queries;

    public PaymentController(PaymentService payments, PaymentQueryService queries) {
        this.payments = payments;
        this.queries = queries;
    }

    @PostMapping("/api/payments/create-order")
    @Operation(summary = "Order for a booking that waits for payment (amount comes from the server; same key, same order)")
    public OrderResponse createOrder(@Valid @RequestBody CreateOrderRequest request,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return payments.createOrder(request.bookingId(), idempotencyKey);
    }

    @PostMapping("/api/payments/verify")
    @Operation(summary = "The browser's checkout callback: signature + provider lookup decide, not the browser")
    public PaymentResult verify(@Valid @RequestBody VerifyRequest request) {
        return payments.verify(request.orderId(), request.paymentId(), request.signature());
    }

    @PostMapping("/api/payments/report-failure")
    @Operation(summary = "Checkout reported a failed payment; closes the attempt if the provider confirms it")
    public PaymentResult reportFailure(@Valid @RequestBody FailureReport request) {
        return payments.reportFailure(request.orderId(), request.paymentId());
    }

    @GetMapping("/api/payments")
    @Operation(summary = "Payment History: my payment attempts, newest first, with search, filters and sorting")
    public PageResponse<PaymentSummary> myPayments(@RequestParam(required = false) String q,
            @RequestParam(required = false) PaymentStatus status, @RequestParam(required = false) String method,
            @RequestParam(required = false) String bookingType,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String sort, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return queries.myPayments(q, status, method, bookingType, from, to, sort, page, size);
    }

    @GetMapping("/api/payments/summary")
    @Operation(summary = "Payment History figures: my payments' counts and amounts for the same filters")
    public MyPaymentsSummary mySummary(@RequestParam(required = false) String q,
            @RequestParam(required = false) PaymentStatus status, @RequestParam(required = false) String method,
            @RequestParam(required = false) String bookingType,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return queries.mySummary(q, status, method, bookingType, from, to);
    }

    @GetMapping("/api/payments/booking/{bookingId}")
    @Operation(summary = "All payment attempts of one booking (owner, or PAYMENT_READ_ANY)")
    public List<PaymentSummary> forBooking(@PathVariable UUID bookingId) {
        return queries.forBooking(bookingId);
    }

    @GetMapping("/api/invoices")
    @Operation(summary = "My invoices, newest first")
    public PageResponse<InvoiceView> myInvoices(@RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return queries.myInvoices(page, size);
    }

    @GetMapping("/api/invoices/booking/{bookingId}")
    @Operation(summary = "The invoice of a confirmed booking (owner, or PAYMENT_READ_ANY)")
    public InvoiceView invoice(@PathVariable UUID bookingId) {
        return queries.invoiceForBooking(bookingId);
    }
}
