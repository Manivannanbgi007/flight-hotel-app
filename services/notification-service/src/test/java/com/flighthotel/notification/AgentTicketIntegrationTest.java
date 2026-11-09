package com.flighthotel.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;

import com.jayway.jsonpath.JsonPath;

/** Phase 9: the support agents' ticket queue, summary, assignment, status and the e-mail on an agent's answer. */
class AgentTicketIntegrationTest extends NotificationIntegrationTest {

    @Test
    void agentsWorkTheQueueAndTheCustomerIsToldByEmail() throws Exception {
        UUID me = UUID.randomUUID();
        String email = "queue-" + me + "@example.com";
        UUID agentId = UUID.randomUUID();
        JwtRequestPostProcessor agent = agent(agentId);
        String subject = "Invoice address " + me.toString().substring(0, 8);
        String opened = mockMvc.perform(post("/api/support/tickets").with(customer(me, email))
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"subject":"%s","category":"PAYMENT","message":"Please change the address."}"""
                                .formatted(subject)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.customerEmail").doesNotExist())   // staff-only fields stay empty
                .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(opened, "$.id");
        String number = JsonPath.read(opened, "$.ticketNumber");

        // The customer's own list: search, category, and the counts above it (Phase 12); never another customer's.
        mockMvc.perform(get("/api/support/tickets/summary").with(customer(me, email)))
                .andExpect(jsonPath("$.total").value(1)).andExpect(jsonPath("$.open").value(1))
                .andExpect(jsonPath("$.inProgress").value(0)).andExpect(jsonPath("$.resolved").value(0));
        mockMvc.perform(get("/api/support/tickets?q=" + number.toLowerCase()).with(customer(me, email)))
                .andExpect(jsonPath("$.totalElements").value(1));
        mockMvc.perform(get("/api/support/tickets?q=invoice&category=PAYMENT").with(customer(me, email)))
                .andExpect(jsonPath("$.totalElements").value(1));
        mockMvc.perform(get("/api/support/tickets?category=ACCOUNT").with(customer(me, email)))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/support/tickets?q=" + number).with(customer(UUID.randomUUID())))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/support/tickets/summary").with(customer(UUID.randomUUID())))
                .andExpect(jsonPath("$.total").value(0));

        long unassignedBefore = summary(agent, "unassigned");
        mockMvc.perform(get("/api/admin/support/tickets?assigned=UNASSIGNED&q=" + email).with(agent))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].ticketNumber").value(number))
                .andExpect(jsonPath("$.content[0].customerEmail").value(email))
                .andExpect(jsonPath("$.content[0].priority").value("NORMAL"))
                .andExpect(jsonPath("$.content[0].assignedToMe").value(false));
        mockMvc.perform(get("/api/admin/support/tickets?q=" + number.toLowerCase()).with(agent))
                .andExpect(jsonPath("$.content[*].id").value(Matchers.contains(id)));
        mockMvc.perform(get("/api/admin/support/tickets?category=PAYMENT&q=" + subject.substring(0, 12)).with(agent))
                .andExpect(jsonPath("$.content[*].id").value(Matchers.hasItem(id)));

        // Take it: in progress, mine.
        mockMvc.perform(post("/api/admin/support/tickets/" + id + "/assign").with(agent))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.assignedAgentId").value(agentId.toString()))
                .andExpect(jsonPath("$.assignedToMe").value(true))
                .andExpect(jsonPath("$.customerEmail").value(email));
        assertThat(summary(agent, "unassigned")).isEqualTo(unassignedBefore - 1);
        assertThat(summary(agent, "assignedToMe")).isEqualTo(1);
        mockMvc.perform(get("/api/admin/support/tickets?assigned=ME").with(agent))
                .andExpect(jsonPath("$.content[*].id").value(Matchers.contains(id)));

        // Answer: waiting for the customer, bell entry and an e-mail with a link (not the text) to the reply.
        mockMvc.perform(post("/api/support/tickets/" + id + "/messages").with(agent)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"Done: the new address is set.\"}"))
                .andExpect(status().isCreated());
        mockMvc.perform(get("/api/support/tickets/" + id).with(customer(me, email)))
                .andExpect(jsonPath("$.status").value("WAITING_CUSTOMER"));
        String mail = waitForMailTo(email);
        assertThat((String) JsonPath.read(mail, "$.Subject")).isEqualTo("New reply on your support ticket " + number);
        assertThat((String) JsonPath.read(mail, "$.Text")).contains("/account/support/" + id)
                .doesNotContain("the new address is set");

        // Escalate with high priority, then close; a closed ticket cannot be reopened by an agent.
        mockMvc.perform(patch("/api/admin/support/tickets/" + id + "/status").with(agent)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ESCALATED\",\"priority\":\"HIGH\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ESCALATED"))
                .andExpect(jsonPath("$.priority").value("HIGH"));
        mockMvc.perform(get("/api/admin/support/tickets?status=ESCALATED&priority=HIGH&q=" + email).with(agent))
                .andExpect(jsonPath("$.totalElements").value(1));
        // Phase 12: agent and created-date filters, and the new counts (a high-priority ticket is counted until closed).
        String today = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).toString();
        String yesterday = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).minusDays(1).toString();
        mockMvc.perform(get("/api/admin/support/tickets?agent=" + agentId + "&from=" + today + "&to=" + today
                        + "&q=" + email).with(agent))
                .andExpect(jsonPath("$.totalElements").value(1));
        mockMvc.perform(get("/api/admin/support/tickets?agent=" + UUID.randomUUID() + "&q=" + email).with(agent))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/admin/support/tickets?to=" + yesterday + "&q=" + email).with(agent))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/admin/support/tickets?from=" + today + "&to=" + yesterday).with(agent))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        long highBefore = summary(agent, "highPriority");
        long resolvedBefore = summary(agent, "resolved");
        assertThat(highBefore).isGreaterThanOrEqualTo(1);
        assertThat(summary(agent, "total")).isGreaterThanOrEqualTo(highBefore);
        mockMvc.perform(patch("/api/admin/support/tickets/" + id + "/status").with(agent)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"RESOLVED\"}"))
                .andExpect(jsonPath("$.status").value("RESOLVED"));
        assertThat(summary(agent, "resolved")).isEqualTo(resolvedBefore + 1);
        assertThat(summary(agent, "highPriority")).isEqualTo(highBefore - 1);
        mockMvc.perform(patch("/api/admin/support/tickets/" + id + "/status").with(agent)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"CLOSED\"}"))
                .andExpect(jsonPath("$.status").value("CLOSED"))
                .andExpect(jsonPath("$.closedAt").exists());
        mockMvc.perform(patch("/api/admin/support/tickets/" + id + "/status").with(agent)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"OPEN\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TICKET_CLOSED"));

        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'audit' "
                + "AND aggregate_id = :id").param("id", id).query(Long.class).single()).isEqualTo(4);

        // Customers have no queue; bad filters are refused.
        mockMvc.perform(get("/api/admin/support/tickets").with(customer(me, email)))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/admin/support/summary").with(customer(me, email)))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/admin/support/tickets?assigned=SOMEONE").with(agent))
                .andExpect(status().isBadRequest());
    }

    @Test
    void anAgentCanHandATicketToAColleague() throws Exception {
        UUID me = UUID.randomUUID();
        String opened = mockMvc.perform(post("/api/support/tickets").with(customer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Account access\",\"category\":\"ACCOUNT\",\"message\":\"Cannot log in.\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(opened, "$.id");
        UUID colleague = UUID.randomUUID();
        mockMvc.perform(post("/api/admin/support/tickets/" + id + "/assign").with(agent(UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"agentId\":\"" + colleague + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedAgentId").value(colleague.toString()))
                .andExpect(jsonPath("$.assignedToMe").value(false));
        mockMvc.perform(get("/api/admin/support/tickets?assigned=ME").with(agent(colleague)))
                .andExpect(jsonPath("$.content[*].id").value(Matchers.contains(id)));
    }

    private static JwtRequestPostProcessor agent(UUID id) {
        return user(id, "agent-" + id + "@example.com", Set.of("SUPPORT_AGENT"),
                Set.of("BOOKING_READ_ANY", "SUPPORT_TICKET_MANAGE"));
    }

    private long summary(JwtRequestPostProcessor agent, String field) throws Exception {
        String body = mockMvc.perform(get("/api/admin/support/summary").with(agent))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(body, "$." + field)).longValue();
    }

    /** The e-mail goes out after the reply is committed. */
    private String waitForMailTo(String address) throws Exception {
        Instant end = Instant.now().plus(Duration.ofSeconds(10));
        while (Instant.now().isBefore(end)) {
            String mail = latestMailTo(address);
            if (mail != null) {
                return mail;
            }
            Thread.sleep(200);
        }
        throw new AssertionError("No e-mail to " + address);
    }
}
