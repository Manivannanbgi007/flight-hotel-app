package com.flighthotel.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import com.flighthotel.events.booking.BookingCancellationFailed;
import com.jayway.jsonpath.JsonPath;

/** Phase 8: customer support tickets (with the automatic one) and the double opt-in newsletter. */
class SupportTicketAndNewsletterIntegrationTest extends NotificationIntegrationTest {

    @Test
    void aCustomerOpensRepliesToAndClosesATicketAboutTheirOwnBooking() throws Exception {
        UUID me = UUID.randomUUID();
        UUID myBooking = UUID.randomUUID();
        UUID someoneElsesBooking = UUID.randomUUID();
        documentsListener.handleBookingEvent(eventId(), awaiting(me, myBooking, "HT-TICK0001", "asha@example.com"));
        documentsListener.handleBookingEvent(eventId(), awaiting(UUID.randomUUID(), someoneElsesBooking, "HT-TICK0002",
                "ravi@example.com"));

        mockMvc.perform(post("/api/support/tickets").with(customer(me)).contentType(MediaType.APPLICATION_JSON)
                        .content(ticket(someoneElsesBooking)))
                .andExpect(status().isUnprocessableContent()).andExpect(jsonPath("$.code").value("INVALID_BOOKING"));
        mockMvc.perform(post("/api/support/tickets").with(customer(me)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Hi\",\"category\":\"OTHER\",\"message\":\"\"}"))
                .andExpect(status().isBadRequest());

        String opened = mockMvc.perform(post("/api/support/tickets").with(customer(me))
                        .contentType(MediaType.APPLICATION_JSON).content(ticket(myBooking)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ticketNumber").value(Matchers.matchesPattern("TK-[2-9A-HJ-NP-Z]{8}")))
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andExpect(jsonPath("$.bookingReference").value("HT-TICK0001"))
                .andExpect(jsonPath("$.messages[0].authorRole").value("CUSTOMER"))
                .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(opened, "$.id");

        mockMvc.perform(get("/api/support/tickets").with(customer(me)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].lastMessageBy").value("CUSTOMER"));
        mockMvc.perform(get("/api/support/tickets/" + id).with(customer(UUID.randomUUID())))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("TICKET_NOT_FOUND"));

        // An agent answers (their pages come in Phase 9): the ticket waits for the customer, who is notified.
        mockMvc.perform(post("/api/support/tickets/" + id + "/messages").with(supportAgent())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"Which date would you like?\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.authorRole").value("SUPPORT_AGENT"));
        mockMvc.perform(get("/api/support/tickets/" + id).with(customer(me)))
                .andExpect(jsonPath("$.status").value("WAITING_CUSTOMER"));
        mockMvc.perform(get("/api/notifications?category=SUPPORT").with(customer(me)))
                .andExpect(jsonPath("$.content[0].link").value("/account/support/" + id));

        mockMvc.perform(post("/api/support/tickets/" + id + "/messages").with(customer(me))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"The 12th, please.\"}"))
                .andExpect(status().isCreated());
        mockMvc.perform(get("/api/support/tickets/" + id).with(customer(me)))
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andExpect(jsonPath("$.messages[*].authorRole").value(Matchers.contains("CUSTOMER", "SUPPORT_AGENT",
                        "CUSTOMER")));

        mockMvc.perform(post("/api/support/tickets/" + id + "/close").with(customer(me)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CLOSED"))
                .andExpect(jsonPath("$.closedAt").exists());
        mockMvc.perform(post("/api/support/tickets/" + id + "/messages").with(customer(me))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"One more thing\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("TICKET_CLOSED"));
        mockMvc.perform(get("/api/support/tickets?status=CLOSED").with(customer(me)))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void aRefusedCancellationOpensOneTicketForTheCustomer() throws Exception {
        UUID me = UUID.randomUUID();
        String event = eventId();
        BookingCancellationFailed failed = BookingCancellationFailed.newBuilder()
                .setBookingId(UUID.randomUUID().toString()).setBookingReference("FL-TICK0003").setBookingType("FLIGHT")
                .setUserId(me.toString()).setCancellationId(UUID.randomUUID().toString()).setTitle("Delhi to Mumbai")
                .setContactEmail("asha-" + me + "@example.com").setCustomerName("Asha Rao").setReason("NOT_ALLOWED")
                .setMessage("The airline does not allow this booking to be cancelled online.")
                .setFailedAt(Instant.now()).build();

        notificationsListener.handleBookingEvent(event, failed);
        notificationsListener.handleBookingEvent(event, failed);

        String tickets = mockMvc.perform(get("/api/support/tickets").with(customer(me)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].category").value("CANCELLATION"))
                .andExpect(jsonPath("$.content[0].lastMessageBy").value("SYSTEM"))
                .andReturn().getResponse().getContentAsString();
        mockMvc.perform(get("/api/support/tickets/" + JsonPath.read(tickets, "$.content[0].id")).with(customer(me)))
                .andExpect(jsonPath("$.subject").value("Cancellation not possible: FL-TICK0003"))
                .andExpect(jsonPath("$.messages[0].message").value(Matchers.containsString("does not allow")));
        mockMvc.perform(get("/api/notifications?category=SUPPORT").with(customer(me)))
                .andExpect(jsonPath("$.content[0].title").value("We opened a support ticket"));
    }

    @Test
    void theNewsletterNeedsTheConfirmationLinkAndEveryEmailCanUnsubscribe() throws Exception {
        String email = "news-" + UUID.randomUUID() + "@Example.com";
        String lower = email.toLowerCase();

        mockMvc.perform(post("/api/newsletter/subscribe").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.message").exists());
        // Asked again straight away: the same answer, but no second e-mail.
        mockMvc.perform(post("/api/newsletter/subscribe").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isAccepted());
        assertThat(messageIdsTo(lower)).hasSize(1);
        String confirmation = JsonPath.read(latestMailTo(lower), "$.Text");
        assertThat(confirmation).contains("48 hours");
        String token = token(confirmation, "/newsletter/confirm\\?token=([A-Za-z0-9_-]+)");
        assertThat(jdbcClient.sql("SELECT status FROM newsletter_subscriptions WHERE email = :e").param("e", lower)
                .query(String.class).single()).isEqualTo("PENDING");

        mockMvc.perform(post("/api/newsletter/confirm").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"wrong-token\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_OR_EXPIRED_TOKEN"));
        mockMvc.perform(post("/api/newsletter/confirm").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + token + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("SUBSCRIBED"))
                .andExpect(jsonPath("$.email").value(Matchers.matchesPattern("n\\*\\*\\*@example\\.com")));
        // The link works once.
        mockMvc.perform(post("/api/newsletter/confirm").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + token + "\"}"))
                .andExpect(status().isBadRequest());

        String welcome = JsonPath.read(latestMailTo(lower), "$.Text");
        assertThat(welcome).contains("Thanks for subscribing");
        String unsubscribe = token(welcome, "/newsletter/unsubscribe\\?token=([A-Za-z0-9_.-]+)");
        // Already subscribed: the form answers the same and sends nothing.
        mockMvc.perform(post("/api/newsletter/subscribe").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + lower + "\"}"))
                .andExpect(status().isAccepted());
        assertThat(messageIdsTo(lower)).hasSize(2);

        mockMvc.perform(post("/api/newsletter/unsubscribe").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + unsubscribe.substring(0, unsubscribe.length() - 2) + "xx\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_TOKEN"));
        mockMvc.perform(post("/api/newsletter/unsubscribe").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + unsubscribe + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UNSUBSCRIBED"));

        // The same address, logged in: subscribed at once from the preferences (verified account e-mail).
        UUID me = UUID.randomUUID();
        mockMvc.perform(put("/api/notifications/preferences").with(customer(me, lower))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"newsletter\":true}"))
                .andExpect(jsonPath("$.newsletter.status").value("SUBSCRIBED"));
        mockMvc.perform(put("/api/notifications/preferences").with(customer(me, lower))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"newsletter\":false}"))
                .andExpect(jsonPath("$.newsletter.status").value("UNSUBSCRIBED"))
                .andExpect(jsonPath("$.newsletter.subscribed").value(false));
        mockMvc.perform(post("/api/newsletter/subscribe").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"not-an-email\"}"))
                .andExpect(status().isBadRequest());
    }

    private static String ticket(UUID bookingId) {
        return """
                {"subject":"Change my check-in date","category":"BOOKING","bookingId":"%s",
                 "message":"Can I arrive one day later?"}""".formatted(bookingId);
    }

    private static String token(String text, String pattern) {
        Matcher matcher = Pattern.compile(pattern).matcher(text);
        assertThat(matcher.find()).as("link in %s", text).isTrue();
        return matcher.group(1);
    }
}
