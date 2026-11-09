package com.flighthotel.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.identity.EmailVerified;
import com.flighthotel.events.payment.PaymentFailed;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.notification.messaging.IdentityEventsListener;
import com.flighthotel.notification.reminder.TravelReminders;
import com.jayway.jsonpath.JsonPath;

/**
 * Phase 8: the Notification Center (filters, read/unread), preferences (locked e-mails, choices respected), the
 * e-mails about payments (with the receipt), the welcome message and travel reminders.
 */
class NotificationCenterIntegrationTest extends NotificationIntegrationTest {

    @Autowired
    IdentityEventsListener identityEvents;

    @Autowired
    TravelReminders reminders;

    @Test
    void preferencesAreOnByDefaultLockedEmailsStayOnAndChoicesAreRespected() throws Exception {
        UUID me = UUID.randomUUID();
        String email = "prefs-" + me + "@example.com";

        mockMvc.perform(get("/api/notifications/preferences").with(customer(me, email)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(10))
                .andExpect(jsonPath("$.items[?(@.enabled == false)]").isEmpty())
                .andExpect(jsonPath("$.items[?(@.category == 'BOOKING' && @.channel == 'EMAIL')].locked")
                        .value(Matchers.contains(true)))
                .andExpect(jsonPath("$.items[?(@.category == 'REMINDER' && @.channel == 'EMAIL')].locked")
                        .value(Matchers.contains(false)))
                .andExpect(jsonPath("$.newsletter.status").value("NONE"));

        mockMvc.perform(put("/api/notifications/preferences").with(customer(me, email))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"category\":\"REFUND\",\"channel\":\"EMAIL\",\"enabled\":false}]}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("PREFERENCE_LOCKED"));
        mockMvc.perform(put("/api/notifications/preferences").with(customer(me, email))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"items":[{"category":"PAYMENT","channel":"IN_APP","enabled":false},
                                          {"category":"REMINDER","channel":"EMAIL","enabled":false}],
                                 "newsletter":true}"""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.category == 'PAYMENT' && @.channel == 'IN_APP')].enabled")
                        .value(Matchers.contains(false)))
                .andExpect(jsonPath("$.newsletter.subscribed").value(true));

        // A failed payment: no bell entry (turned off), but the e-mail still goes out (locked on).
        UUID bookingId = UUID.randomUUID();
        documentsListener.handleBookingEvent(eventId(), awaiting(me, bookingId, "HT-PREF0001", email));
        notificationsListener.handlePaymentEvent(eventId(), PaymentFailed.newBuilder()
                .setPaymentId(UUID.randomUUID().toString()).setBookingId(bookingId.toString()).setUserId(me.toString())
                .setProvider("DEMO").setFailureCode("DECLINED").setFailureReason("Card declined")
                .setFailedAt(Instant.now()).build());
        mockMvc.perform(get("/api/notifications?category=PAYMENT").with(customer(me, email)))
                .andExpect(jsonPath("$.totalElements").value(0));
        String mail = latestMailTo(email);
        assertThat((String) JsonPath.read(mail, "$.Subject")).isEqualTo("Your payment did not go through HT-PREF0001");
        assertThat((String) JsonPath.read(mail, "$.Text")).contains("Card declined")
                .contains("https://app.example.test/my-trips/" + bookingId + "/pay");
    }

    @Test
    void theCenterFiltersByCategoryAndMarksReadAndUnread() throws Exception {
        UUID me = UUID.randomUUID();
        String email = "center-" + me + "@example.com";
        UUID bookingId = UUID.randomUUID();
        identityEvents.handle(eventId(), EmailVerified.newBuilder().setUserId(me.toString()).setEmail(email)
                .setFirstName("Asha").setVerifiedAt(Instant.now()).build());
        // Replayed from last week (a new consumer group starts at the beginning of the topic): no late welcome.
        identityEvents.handle(eventId(), EmailVerified.newBuilder().setUserId(me.toString()).setEmail(email)
                .setFirstName("Asha").setVerifiedAt(Instant.now().minus(Duration.ofDays(3))).build());
        notificationsListener.handleBookingEvent(eventId(), awaiting(me, bookingId, "HT-CENT0001", email));
        documentsListener.handleBookingEvent(eventId(), awaiting(me, bookingId, "HT-CENT0001", email));

        String all = mockMvc.perform(get("/api/notifications").with(customer(me, email)))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[*].title").value(Matchers.containsInAnyOrder("Welcome to FlightHotel",
                        "Complete your payment")))
                .andReturn().getResponse().getContentAsString();
        mockMvc.perform(get("/api/notifications?category=ACCOUNT").with(customer(me, email)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].message").value(Matchers.containsString("Hello Asha")));
        mockMvc.perform(get("/api/notifications?category=NONSENSE").with(customer(me, email)))
                .andExpect(status().isBadRequest());

        String id = JsonPath.read(all, "$.content[0].id");
        mockMvc.perform(post("/api/notifications/" + id + "/read").with(customer(me, email)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/notifications/unread-count").with(customer(me, email)))
                .andExpect(jsonPath("$.count").value(1));
        mockMvc.perform(post("/api/notifications/" + id + "/unread").with(customer(me, email)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/notifications?unreadOnly=true").with(customer(me, email)))
                .andExpect(jsonPath("$.totalElements").value(2));
        mockMvc.perform(post("/api/notifications/" + id + "/unread").with(customer(UUID.randomUUID())))
                .andExpect(status().isNotFound());

        // The "booking received" e-mail with the payment deadline.
        String mail = latestMailTo(email);
        assertThat((String) JsonPath.read(mail, "$.Subject")).isEqualTo("Complete your payment HT-CENT0001");
        assertThat((String) JsonPath.read(mail, "$.Text")).contains("Amount to pay: ₹6,300.00").contains("IST")
                .contains("/my-trips/" + bookingId + "/pay");
    }

    @Test
    void aPaymentReceivedEmailCarriesTheReceipt() throws Exception {
        UUID me = UUID.randomUUID();
        String email = "receipt-" + me + "@example.com";
        UUID bookingId = UUID.randomUUID();
        documentsListener.handleBookingEvent(eventId(), awaiting(me, bookingId, "HT-RCPT0001", email));

        notificationsListener.handlePaymentEvent(eventId(), PaymentSucceeded.newBuilder()
                .setPaymentId(UUID.randomUUID().toString()).setBookingId(bookingId.toString()).setUserId(me.toString())
                .setProvider("DEMO").setProviderPaymentId("pay_demo_ok_9").setAmount(EventMoney.of(new BigDecimal("6300"), "INR"))
                .setMethod("card").setSucceededAt(Instant.now()).build());

        String mail = latestMailTo(email);
        assertThat((String) JsonPath.read(mail, "$.Subject")).isEqualTo("Payment received HT-RCPT0001");
        assertThat((String) JsonPath.read(mail, "$.Text")).contains("Amount paid: ₹6,300.00")
                .contains("Sea Breeze Resort · 2 nights · 1 room");
        assertThat((List<String>) JsonPath.read(mail, "$.Attachments[*].FileName"))
                .containsExactly("HT-RCPT0001-payment-receipt.pdf");
    }

    @Test
    void aTravelReminderGoesOutOnceADayBeforeAndNeverForCancelledOrLastMinuteTrips() throws Exception {
        UUID me = UUID.randomUUID();
        String email = "trip-" + me + "@example.com";
        UUID tomorrow = UUID.randomUUID();
        UUID cancelled = UUID.randomUUID();
        UUID lastMinute = UUID.randomUUID();
        Instant inTwentyHours = Instant.now().plus(Duration.ofHours(20));

        // Confirmed weeks ago for a stay that starts in 20 hours: due now.
        documentsListener.handleBookingEvent(eventId(), backdated(hotelConfirmed(me, tomorrow, "HT-TRIP0001", email,
                inTwentyHours)));
        documentsListener.handleBookingEvent(eventId(), backdated(hotelConfirmed(me, cancelled, "HT-TRIP0002", email,
                inTwentyHours)));
        documentsListener.handleBookingEvent(eventId(), BookingCancelled.newBuilder()
                .setBookingId(cancelled.toString()).setBookingReference("HT-TRIP0002").setBookingType("HOTEL")
                .setUserId(me.toString()).setCancellationId(UUID.randomUUID().toString()).setTitle("Sea Breeze Resort")
                .setContactEmail(email).setCustomerName("Asha Rao").setInitiatedBy("CUSTOMER")
                .setPaidAmount(EventMoney.of(new BigDecimal("6300"), "INR"))
                .setCancellationFee(EventMoney.of(BigDecimal.ZERO, "INR"))
                .setRefundAmount(EventMoney.of(new BigDecimal("6300"), "INR")).setCancelledAt(Instant.now()).build());
        // Booked just now for tomorrow: the confirmation already says everything.
        documentsListener.handleBookingEvent(eventId(), hotelConfirmed(me, lastMinute, "HT-TRIP0003", email,
                inTwentyHours));

        reminders.sendDueReminders();
        reminders.sendDueReminders();

        List<String> sent = jdbcClient.sql("""
                        SELECT booking_reference FROM upcoming_trips
                        WHERE user_id = UUID_TO_BIN(:user) AND reminder_sent_at IS NOT NULL AND status = 'ACTIVE'
                        ORDER BY booking_reference""")
                .param("user", me.toString()).query(String.class).list();
        assertThat(sent).containsExactly("HT-TRIP0001", "HT-TRIP0003");   // TRIP0003: skipped at confirmation
        assertThat(messageIdsTo(email)).hasSize(1);
        String mail = latestMailTo(email);
        assertThat((String) JsonPath.read(mail, "$.Subject")).isEqualTo("Your stay starts tomorrow: Sea Breeze Resort");
        assertThat((String) JsonPath.read(mail, "$.Text")).contains("HT-TRIP0001").contains("Check-in: ")
                .contains("Hotel confirmation number: HK7M3Q9P2X");
        mockMvc.perform(get("/api/notifications?category=REMINDER").with(customer(me, email)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].link").value("/my-trips/" + tomorrow));
    }

    /** As if the booking had been confirmed two weeks ago. */
    private static com.flighthotel.events.booking.BookingConfirmed backdated(
            com.flighthotel.events.booking.BookingConfirmed confirmed) {
        return com.flighthotel.events.booking.BookingConfirmed.newBuilder(confirmed)
                .setConfirmedAt(Instant.now().minus(Duration.ofDays(14))).build();
    }
}
