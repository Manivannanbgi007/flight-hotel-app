package com.flighthotel.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.payment.InvoiceIssued;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.jayway.jsonpath.JsonPath;

/**
 * Phase 8 exit checks: PDF content (every document type says what the server's events say) and download access (the
 * owner gets the file, another customer never does, staff may). Documents are made once per source.
 */
class DocumentIntegrationTest extends NotificationIntegrationTest {

    @Test
    void aHotelConfirmationIsMadeOnceAndOnlyItsOwnerOrStaffCanDownloadIt() throws Exception {
        UUID owner = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        String event = eventId();
        documentsListener.handleBookingEvent(event, hotelConfirmed(owner, bookingId, "HT-DOC00001",
                "asha@example.com", null));
        documentsListener.handleBookingEvent(event, hotelConfirmed(owner, bookingId, "HT-DOC00001",
                "asha@example.com", null));
        // The e-mail listener asks for the same document: it already exists.
        notificationsListener.handleBookingEvent(eventId(), hotelConfirmed(owner, bookingId, "HT-DOC00001",
                "asha@example.com", null));

        String list = mockMvc.perform(get("/api/documents?bookingId=" + bookingId).with(customer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].type").value("BOOKING_CONFIRMATION"))
                .andExpect(jsonPath("$[0].fileName").value("HT-DOC00001-confirmation.pdf"))
                .andReturn().getResponse().getContentAsString();
        String documentId = JsonPath.read(list, "$[0].id");
        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM documents WHERE booking_id = UUID_TO_BIN(:id)")
                .param("id", bookingId.toString()).query(Long.class).single()).isEqualTo(1L);

        byte[] pdf = mockMvc.perform(get("/api/documents/" + documentId + "/download").with(customer(owner)))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/pdf"))
                .andExpect(header().string("Content-Disposition",
                        Matchers.containsString("attachment; filename=\"HT-DOC00001-confirmation.pdf\"")))
                .andExpect(header().string("Cache-Control", Matchers.containsString("no-store")))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(new String(pdf, 0, 5)).isEqualTo("%PDF-");
        String text = pdfText(pdf);
        assertThat(text).contains("Hotel booking confirmation").contains("HT-DOC00001").contains("HK7M3Q9P2X")
                .contains("Sea Breeze Resort").contains("Calangute Beach Road, Goa").contains("Deluxe Sea View")
                .contains("from 14:00").contains("until 11:00").contains("Asha Rao")
                .contains("₹6,300.00").contains("Free cancellation until 2 days before check-in.")
                .contains("DEMO");

        // Another customer: no list entries, no file. Staff: allowed. Nobody without a login.
        UUID stranger = UUID.randomUUID();
        mockMvc.perform(get("/api/documents?bookingId=" + bookingId).with(customer(stranger)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
        mockMvc.perform(get("/api/documents/" + documentId + "/download").with(customer(stranger)))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("DOCUMENT_NOT_FOUND"));
        mockMvc.perform(get("/api/documents/" + documentId + "/download").with(supportAgent()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/documents/" + documentId + "/download")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/documents/" + UUID.randomUUID() + "/download").with(customer(owner)))
                .andExpect(status().isNotFound());
    }

    @Test
    void aFlightGetsAnItineraryAndAnETicketWithOnePagePerTraveller() throws Exception {
        UUID owner = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        documentsListener.handleBookingEvent(eventId(), flightConfirmed(owner, bookingId, "FL-DOC00002",
                "asha@example.com"));

        String list = mockMvc.perform(get("/api/documents?bookingId=" + bookingId).with(customer(owner)))
                .andExpect(jsonPath("$[*].type").value(Matchers.contains("BOOKING_CONFIRMATION", "E_TICKET")))
                .andReturn().getResponse().getContentAsString();

        String itinerary = pdfText(download(owner, JsonPath.read(list, "$[0].id")));
        assertThat(itinerary).contains("Flight booking confirmation").contains("FL-DOC00002").contains("K7M2QX")
                .contains("Delhi (DEL) to Mumbai (BOM)").contains("AI 504").contains("06:45").contains("08:55")
                .contains("Economy · Economy Flex").contains("Checked 20 kg, cabin 7 kg")
                .contains("0981234567891").contains("0981234567892").contains("- ₹500.00").contains("₹9,850.00")
                .doesNotContain("DEMO:");

        byte[] eTicket = download(owner, JsonPath.read(list, "$[1].id"));
        assertThat(pdfPages(eTicket)).isEqualTo(2);
        assertThat(pdfText(eTicket)).contains("Electronic ticket").contains("Passenger: Asha Rao")
                .contains("Passenger: Meera Rao").contains("Meera Rao (Child)").contains("0981234567892")
                .contains("photo ID");
    }

    @Test
    void receiptsTheInvoiceAndTheCancellationSayWhatTheEventsSay() throws Exception {
        UUID owner = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        UUID paymentId = UUID.randomUUID();
        documentsListener.handleBookingEvent(eventId(), awaiting(owner, bookingId, "HT-DOC00003", "asha@example.com"));
        documentsListener.handlePaymentEvent(eventId(), PaymentSucceeded.newBuilder().setPaymentId(paymentId.toString())
                .setBookingId(bookingId.toString()).setUserId(owner.toString()).setProvider("DEMO")
                .setProviderPaymentId("pay_demo_ok_123").setAmount(EventMoney.of(new BigDecimal("6300"), "INR"))
                .setMethod("upi").setSucceededAt(Instant.now()).build());
        documentsListener.handlePaymentEvent(eventId(), InvoiceIssued.newBuilder().setInvoiceId(UUID.randomUUID().toString())
                .setInvoiceNumber("INV/2026-27/000123").setBookingId(bookingId.toString())
                .setPaymentId(paymentId.toString()).setUserId(owner.toString())
                .setTotalAmount(EventMoney.of(new BigDecimal("6300"), "INR")).setIssuedAt(Instant.now())
                .setBookingReference("HT-DOC00003").setBillingName("Asha Rao").setBillingEmail("asha@example.com")
                .setDescription("Sea Breeze Resort · 2 nights · 1 room")
                .setTaxableAmount(EventMoney.of(new BigDecimal("6000"), "INR"))
                .setTaxAmount(EventMoney.of(new BigDecimal("300"), "INR"))
                .setDiscountAmount(EventMoney.of(BigDecimal.ZERO, "INR")).build());
        UUID cancellationId = UUID.randomUUID();
        documentsListener.handleBookingEvent(eventId(), BookingCancelled.newBuilder().setBookingId(bookingId.toString())
                .setBookingReference("HT-DOC00003").setBookingType("HOTEL").setUserId(owner.toString())
                .setCancellationId(cancellationId.toString()).setTitle("Sea Breeze Resort")
                .setContactEmail("asha@example.com").setCustomerName("Asha Rao").setInitiatedBy("SUPPORT_AGENT")
                .setPaidAmount(EventMoney.of(new BigDecimal("6300"), "INR"))
                .setCancellationFee(EventMoney.of(new BigDecimal("3150"), "INR"))
                .setRefundAmount(EventMoney.of(new BigDecimal("3150"), "INR")).setSupplierReference("HXK7M3Q9P2")
                .setCancelledAt(Instant.now()).build());
        documentsListener.handlePaymentEvent(eventId(), RefundCompleted.newBuilder().setRefundId(UUID.randomUUID().toString())
                .setRefundRequestId(UUID.randomUUID().toString()).setPaymentId(paymentId.toString())
                .setBookingId(bookingId.toString()).setUserId(owner.toString())
                .setAmount(EventMoney.of(new BigDecimal("3150"), "INR")).setCompletedAt(Instant.now()).build());

        String list = mockMvc.perform(get("/api/documents?bookingId=" + bookingId).with(customer(owner)))
                .andExpect(jsonPath("$[*].type").value(Matchers.contains("PAYMENT_RECEIPT", "INVOICE",
                        "CANCELLATION_CONFIRMATION", "REFUND_RECEIPT")))
                .andExpect(jsonPath("$[1].fileName").value("INV-2026-27-000123-invoice.pdf"))
                .andExpect(jsonPath("$[0].referenceId").value(paymentId.toString()))
                .andReturn().getResponse().getContentAsString();
        List<String> ids = JsonPath.read(list, "$[*].id");

        assertThat(pdfText(download(owner, ids.get(0)))).contains("Payment receipt").contains("HT-DOC00003")
                .contains("₹6,300.00").contains("UPI").contains("pay_demo_ok_123").contains(paymentId.toString())
                .contains("Sea Breeze Resort · 2 nights · 1 room").contains("Demo payment");
        assertThat(pdfText(download(owner, ids.get(1)))).contains("Tax invoice").contains("INV/2026-27/000123")
                .contains("Asha Rao").contains("Taxable value").contains("₹6,000.00").contains("GST")
                .contains("₹300.00").contains("₹6,300.00");
        assertThat(pdfText(download(owner, ids.get(2)))).contains("Cancellation confirmation").contains("HXK7M3Q9P2")
                .contains("Our support team, on your behalf").contains("₹3,150.00").contains("5 to 7 working days");
        assertThat(pdfText(download(owner, ids.get(3)))).contains("Refund receipt").contains("₹3,150.00")
                .contains("HT-DOC00003").contains(paymentId.toString());
    }

    @Test
    void theConfirmationEmailCarriesThePdfs() throws Exception {
        UUID owner = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        String to = "pdf-" + UUID.randomUUID() + "@example.com";

        notificationsListener.handleBookingEvent(eventId(), flightConfirmed(owner, bookingId, "FL-DOC00004", to));

        String message = latestMailTo(to);
        assertThat((List<String>) JsonPath.read(message, "$.Attachments[*].FileName"))
                .containsExactly("FL-DOC00004-confirmation.pdf", "FL-DOC00004-e-ticket.pdf");
        assertThat((List<String>) JsonPath.read(message, "$.Attachments[*].ContentType"))
                .containsOnly("application/pdf");
    }

    private byte[] download(UUID owner, String documentId) throws Exception {
        return mockMvc.perform(get("/api/documents/" + documentId + "/download").with(customer(owner)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
    }
}
