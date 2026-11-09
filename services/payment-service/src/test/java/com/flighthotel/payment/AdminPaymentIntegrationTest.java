package com.flighthotel.payment;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Set;
import java.util.UUID;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingRefundRequested;

/** Phase 9: the admin portal's payment and refund lists and the payment details with its refunds (section 14.3). */
class AdminPaymentIntegrationTest extends PaymentIntegrationTest {

    @Test
    void adminsListPaymentsAndRefundsAndOwnersSeeTheirPaymentDetails() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID bookingId = payable(userId, "3000.00");
        String reference = "HT-" + bookingId.toString().substring(0, 8).toUpperCase();
        String orderId = json(createOrder(userId, bookingId), "$.orderId");
        String checkout = mockMvc.perform(post("/api/payments/demo/pay").with(customer(userId))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"orderId\":\"" + orderId + "\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String paymentId = json(verifyCall(userId, orderId, json(checkout, "$.paymentId"), json(checkout, "$.signature"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(), "$.paymentId");
        UUID refundRequest = UUID.randomUUID();
        bookingEvents.handle(eventId(), BookingRefundRequested.newBuilder().setRefundRequestId(refundRequest.toString())
                .setBookingId(bookingId.toString()).setBookingReference(reference).setUserId(userId.toString())
                .setPaymentId(paymentId).setAmount(EventMoney.of(new BigDecimal("500.00"), "INR")).setReason("GOODWILL")
                .setContactEmail("asha@example.com").setCustomerName("Asha Rao").setRequestedAt(Instant.now()).build());
        String today = LocalDate.now(ZoneId.of("Asia/Kolkata")).toString();

        mockMvc.perform(get("/api/admin/payments?q=" + reference.toLowerCase() + "&from=" + today + "&to=" + today)
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(paymentId))
                .andExpect(jsonPath("$.content[0].bookingReference").value(reference))
                .andExpect(jsonPath("$.content[0].status").value("PARTIALLY_REFUNDED"))
                .andExpect(jsonPath("$.content[0].amount").value(3000.0))
                .andExpect(jsonPath("$.content[0].refundedAmount").value(500.0))
                .andExpect(jsonPath("$.content[0].contactEmail").value("asha@example.com"))
                .andExpect(jsonPath("$.content[0].userId").value(userId.toString()))
                .andExpect(jsonPath("$.content[0].providerOrderId").value(orderId))
                .andExpect(jsonPath("$.content[0].providerPaymentId").isNotEmpty());
        mockMvc.perform(get("/api/admin/payments?q=" + paymentId).with(admin()))
                .andExpect(jsonPath("$.content[*].id").value(Matchers.contains(paymentId)));
        mockMvc.perform(get("/api/admin/payments?status=FAILED&q=" + reference).with(admin()))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/admin/payments?sort=amount,desc&size=100").with(admin()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/admin/payments?sort=provider").with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_SORT"));

        mockMvc.perform(get("/api/admin/refunds?status=PROCESSED&q=" + reference).with(admin()))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].paymentId").value(paymentId))
                .andExpect(jsonPath("$.content[0].bookingReference").value(reference))
                .andExpect(jsonPath("$.content[0].reason").value("GOODWILL"))
                .andExpect(jsonPath("$.content[0].amount").value(500.0));
        mockMvc.perform(get("/api/admin/refunds?status=FAILED&q=" + reference).with(admin()))
                .andExpect(jsonPath("$.totalElements").value(0));

        // Details: the owner and staff; anyone else gets 404.
        getAs(userId, "/api/payments/" + paymentId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingReference").value(reference))
                .andExpect(jsonPath("$.refunds.length()").value(1))
                .andExpect(jsonPath("$.refunds[0].status").value("PROCESSED"));
        mockMvc.perform(get("/api/payments/" + paymentId).with(admin())).andExpect(status().isOk());
        getAs(UUID.randomUUID(), "/api/payments/" + paymentId).andExpect(status().isNotFound());

        // Admin dashboard (Phase 12): booking type, method and e-mail filters, and a summary for the same filters.
        String row = mockMvc.perform(get("/api/admin/payments?q=" + reference).with(admin()))
                .andExpect(jsonPath("$.content[0].bookingType").value("HOTEL"))
                .andReturn().getResponse().getContentAsString();
        String method = json(row, "$.content[0].method");
        mockMvc.perform(get("/api/admin/payments?bookingType=HOTEL&method=" + method.toUpperCase() + "&q=" + reference)
                        .with(admin()))
                .andExpect(jsonPath("$.totalElements").value(1));
        mockMvc.perform(get("/api/admin/payments?bookingType=FLIGHT&q=" + reference).with(admin()))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/admin/payments?method=no-such-method&q=" + reference).with(admin()))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/admin/payments?bookingType=CAR").with(admin()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        mockMvc.perform(get("/api/admin/payments?q=ASHA@example.com&status=PARTIALLY_REFUNDED&size=100").with(admin()))
                .andExpect(jsonPath("$.content[*].id").value(Matchers.hasItem(paymentId)));
        mockMvc.perform(get("/api/admin/payments/summary?q=" + reference + "&from=" + today + "&to=" + today)
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.successful").value(1))
                .andExpect(jsonPath("$.failed").value(0))
                .andExpect(jsonPath("$.pending").value(0))
                .andExpect(jsonPath("$.collectedAmount").value(3000.0))
                .andExpect(jsonPath("$.refundedAmount").value(500.0))
                .andExpect(jsonPath("$.currency").value("INR"));
        mockMvc.perform(get("/api/admin/payments/summary?bookingType=FLIGHT&q=" + reference).with(admin()))
                .andExpect(jsonPath("$.total").value(0))
                .andExpect(jsonPath("$.collectedAmount").value(0))
                .andExpect(jsonPath("$.refundedAmount").value(0));
        mockMvc.perform(get("/api/admin/payments/summary?status=FAILED&q=" + reference).with(admin()))
                .andExpect(jsonPath("$.total").value(0));
        getAs(userId, "/api/admin/payments/summary").andExpect(status().isForbidden());
        getAs(userId, "/api/payments/" + paymentId)
                .andExpect(jsonPath("$.bookingType").value("HOTEL"))
                .andExpect(jsonPath("$.contactEmail").value("asha@example.com"));

        // Customers and support agents without the permission cannot list everybody's payments.
        getAs(userId, "/api/admin/payments").andExpect(status().isForbidden());
        getAs(userId, "/api/admin/refunds").andExpect(status().isForbidden());
    }

    private static JwtRequestPostProcessor admin() {
        return user(UUID.randomUUID(), Set.of("ADMIN"), Set.of("PAYMENT_READ_ANY"));
    }
}
