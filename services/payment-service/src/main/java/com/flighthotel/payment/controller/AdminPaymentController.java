package com.flighthotel.payment.controller;

import java.time.LocalDate;
import java.util.UUID;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.payment.entity.PaymentStatus;
import com.flighthotel.payment.entity.Refund;
import com.flighthotel.payment.service.AdminPaymentService;
import com.flighthotel.payment.service.AdminPaymentService.AdminPaymentRow;
import com.flighthotel.payment.service.AdminPaymentService.PaymentDetails;
import com.flighthotel.payment.service.AdminPaymentService.PaymentSummary;
import com.flighthotel.payment.service.AdminPaymentService.RefundView;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** Admin portal: payments and refunds (read only; permissions checked in {@link AdminPaymentService}). */
@RestController
@Tag(name = "Admin: payments", description = "Payments and refunds of all customers")
public class AdminPaymentController {

    private final AdminPaymentService admin;

    public AdminPaymentController(AdminPaymentService admin) {
        this.admin = admin;
    }

    @GetMapping("/api/admin/payments")
    @Operation(summary = "All payment attempts (PAYMENT_READ_ANY)")
    public PageResponse<AdminPaymentRow> payments(@RequestParam(required = false) String q,
            @RequestParam(required = false) PaymentStatus status, @RequestParam(required = false) String provider,
            @RequestParam(required = false) String method, @RequestParam(required = false) String bookingType,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String sort) {
        return admin.payments(q, status, provider, method, bookingType, from, to, page, size, sort);
    }

    @GetMapping("/api/admin/payments/summary")
    @Operation(summary = "Counts and amounts for the same filters as the payments list (PAYMENT_READ_ANY)")
    public PaymentSummary summary(@RequestParam(required = false) String q,
            @RequestParam(required = false) PaymentStatus status, @RequestParam(required = false) String provider,
            @RequestParam(required = false) String method, @RequestParam(required = false) String bookingType,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return admin.summary(q, status, provider, method, bookingType, from, to);
    }

    @GetMapping("/api/payments/{paymentId}")
    @Operation(summary = "One payment with its refunds (owner or PAYMENT_READ_ANY)")
    public PaymentDetails payment(@PathVariable UUID paymentId) {
        return admin.payment(paymentId);
    }

    @GetMapping("/api/admin/refunds")
    @Operation(summary = "All refunds (PAYMENT_READ_ANY)")
    public PageResponse<RefundView> refunds(@RequestParam(required = false) String q,
            @RequestParam(required = false) Refund.Status status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return admin.refunds(q, status, from, to, page, size);
    }
}
