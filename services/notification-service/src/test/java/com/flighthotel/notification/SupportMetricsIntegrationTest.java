package com.flighthotel.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;

import com.jayway.jsonpath.JsonPath;

/**
 * Phase 11 support dashboard ({@code GET /api/admin/support/metrics}): tickets by status and age now, opened vs
 * resolved in the range and per interval, first-response and resolution times, and the comparison with the previous
 * period, each checked against the tickets and messages written for it. Also how a ticket's resolution time is kept.
 */
class SupportMetricsIntegrationTest extends NotificationIntegrationTest {

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final String JUNE = "range=CUSTOM&from=2025-06-01&to=2025-06-30";

    /** A ticket as the test wrote it. {@code firstReply}: the first agent or admin answer, if any. */
    record Ticket(String status, String category, Instant createdAt, Instant resolvedAt, Instant firstReply) {

        boolean open() {
            return !status.equals("RESOLVED") && !status.equals("CLOSED");
        }
    }

    private final List<Ticket> tickets = new ArrayList<>();

    @Test
    void theFiguresMatchTheTicketsAndTheirMessages() throws Exception {
        JwtRequestPostProcessor agent = agent();
        String before = metrics(agent, "range=TODAY");
        Instant now = Instant.now();

        // June 2025, its previous period (2 .. 31 May) and just outside both.
        ticket("CLOSED", "BOOKING", india("2025-06-02T10:00"), india("2025-06-03T10:00"), 45, "SUPPORT_AGENT");
        ticket("RESOLVED", "PAYMENT", india("2025-06-05T09:00"), india("2025-06-12T09:00"), 180, "ADMIN");
        ticket("WAITING_CUSTOMER", "REFUND", india("2025-06-10T08:00"), null, 30, "SUPPORT_AGENT");
        ticket("OPEN", "BOOKING", india("2025-06-20T12:00"), null, null, null);   // waiting for an answer
        ticket("RESOLVED", "CANCELLATION", india("2025-06-25T11:00"), india("2025-06-26T11:00"), null, null);
        ticket("RESOLVED", "OTHER", india("2025-05-20T10:00"), india("2025-06-01T00:10"), 120, "SUPPORT_AGENT");
        ticket("CLOSED", "ACCOUNT", india("2025-05-25T10:00"), india("2025-05-28T10:00"), 60, "ADMIN");
        ticket("OPEN", "OTHER", india("2025-06-30T23:50"), null, 15, "CUSTOMER");   // only the customer wrote again
        ticket("OPEN", "PAYMENT", india("2025-07-01T00:05"), null, null, null);
        ticket("RESOLVED", "BOOKING", india("2025-05-01T23:59"), india("2025-06-15T10:00"), 600, "SUPPORT_AGENT");
        // Open now, of every age.
        ticket("OPEN", "BOOKING", now.minus(2, ChronoUnit.HOURS), null, null, null);
        ticket("IN_PROGRESS", "BOOKING", now.minus(30, ChronoUnit.HOURS), null, null, null);
        ticket("ESCALATED", "REFUND", now.minus(100, ChronoUnit.HOURS), null, 5, "SUPPORT_AGENT");
        ticket("OPEN", "OTHER", now.minus(200, ChronoUnit.HOURS), null, null, null);

        String june = metrics(agent, JUNE + "&interval=WEEK");
        assertThat((String) JsonPath.read(june, "$.range.preset")).isEqualTo("CUSTOM");
        assertThat((String) JsonPath.read(june, "$.interval")).isEqualTo("WEEK");
        assertThat((String) JsonPath.read(june, "$.previousRange.from")).isEqualTo("2025-05-02");
        assertThat((String) JsonPath.read(june, "$.previousRange.to")).isEqualTo("2025-05-31");

        // Opened and resolved in June, against the tickets.
        LocalDate from = LocalDate.of(2025, 6, 1);
        LocalDate to = LocalDate.of(2025, 6, 30);
        List<Ticket> opened = tickets.stream().filter(t -> in(t.createdAt(), from, to)).toList();
        List<Ticket> resolved = tickets.stream().filter(t -> in(t.resolvedAt(), from, to)).toList();
        assertThat(opened).hasSize(6);
        assertThat(resolved).hasSize(5);
        assertThat(count(june, "$.opened")).isEqualTo(opened.size());
        assertThat(count(june, "$.resolved")).isEqualTo(resolved.size());
        for (String category : List.of("BOOKING", "PAYMENT", "REFUND", "CANCELLATION", "ACCOUNT", "OTHER")) {
            assertThat(count(june, "$.openedByCategory." + category)).as(category)
                    .isEqualTo(opened.stream().filter(t -> t.category().equals(category)).count());
        }

        // First answers to June's tickets: 45, 180 and 30 minutes; two still wait for one (the resolved one does not).
        assertThat(count(june, "$.firstResponse.responded")).isEqualTo(3);
        assertThat(money(june, "$.firstResponse.averageMinutes")).isEqualByComparingTo(averageMinutes(opened))
                .isEqualByComparingTo("85.0");
        assertThat(money(june, "$.firstResponse.medianMinutes")).isEqualByComparingTo("45.0");
        assertThat(count(june, "$.firstResponse.awaiting")).isEqualTo(2);
        assertThat(count(june, "$.resolution.resolved")).isEqualTo(5);
        assertThat(money(june, "$.resolution.averageHours")).isEqualByComparingTo(BigDecimal.valueOf(resolved.stream()
                .mapToLong(t -> Duration.between(t.createdAt(), t.resolvedAt()).toSeconds()).sum())
                .divide(BigDecimal.valueOf(resolved.size() * 3600L), 1, RoundingMode.HALF_UP));

        // The weekly series adds up and matches the tickets of each week.
        List<String> starts = JsonPath.read(june, "$.series[*].start");
        List<String> ends = JsonPath.read(june, "$.series[*].end");
        assertThat(starts.getFirst()).isEqualTo("2025-06-01");
        assertThat(ends.getLast()).isEqualTo("2025-06-30");
        for (int i = 0; i < starts.size(); i++) {
            LocalDate start = LocalDate.parse(starts.get(i));
            LocalDate end = LocalDate.parse(ends.get(i));
            assertThat(count(june, "$.series[" + i + "].opened")).as(starts.get(i))
                    .isEqualTo(tickets.stream().filter(t -> in(t.createdAt(), start, end)).count());
            assertThat(count(june, "$.series[" + i + "].resolved")).as(starts.get(i))
                    .isEqualTo(tickets.stream().filter(t -> in(t.resolvedAt(), start, end)).count());
        }

        // Against 2 .. 31 May: two opened (answered after 120 and 60 minutes), one resolved.
        assertThat(count(june, "$.comparison.opened.previous")).isEqualTo(2);
        assertThat(money(june, "$.comparison.opened.changePercent")).isEqualByComparingTo("200.0");
        assertThat(count(june, "$.comparison.resolved.previous")).isEqualTo(1);
        assertThat(money(june, "$.comparison.averageFirstResponseMinutes.previous")).isEqualByComparingTo("90.0");
        assertThat(money(june, "$.comparison.averageFirstResponseMinutes.change")).isEqualByComparingTo("-5.0");
        assertThat((String) JsonPath.read(june, "$.comparison.averageFirstResponseMinutes.trend")).isEqualTo("DOWN");

        // Now: every status and age bucket grew by exactly the tickets written here.
        String after = metrics(agent, "range=TODAY");
        for (String status : List.of("OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "ESCALATED", "RESOLVED", "CLOSED")) {
            assertThat(count(after, "$.byStatus." + status) - count(before, "$.byStatus." + status)).as(status)
                    .isEqualTo(tickets.stream().filter(t -> t.status().equals(status)).count());
        }
        List<Ticket> open = tickets.stream().filter(Ticket::open).toList();
        assertThat(count(after, "$.open") - count(before, "$.open")).isEqualTo(open.size());
        long[] ages = new long[4];
        open.forEach(t -> {
            long hours = Duration.between(t.createdAt(), now).toHours();
            ages[hours < 24 ? 0 : hours < 72 ? 1 : hours < 168 ? 2 : 3]++;
        });
        assertThat(ages).containsExactly(1, 1, 1, 5);
        List<String> keys = JsonPath.read(after, "$.age.buckets[*].key");
        assertThat(keys).containsExactly("UNDER_1_DAY", "1_TO_3_DAYS", "3_TO_7_DAYS", "OVER_7_DAYS");
        for (int i = 0; i < 4; i++) {
            assertThat(count(after, "$.age.buckets[" + i + "].count") - count(before, "$.age.buckets[" + i + "].count"))
                    .as(keys.get(i)).isEqualTo(ages[i]);
        }
        Instant oldest = Instant.parse(JsonPath.read(after, "$.age.oldestOpenedAt"));
        assertThat(oldest).isBeforeOrEqualTo(india("2025-06-10T08:00"));
    }

    @Test
    void aTicketIsResolvedOnceAndReopenedByTheCustomer() throws Exception {
        UUID customerId = UUID.randomUUID();
        JwtRequestPostProcessor customer = customer(customerId, "metrics-" + customerId + "@example.com");
        JwtRequestPostProcessor agent = agent();
        String body = mockMvc.perform(post("/api/support/tickets").with(customer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Seat change\",\"category\":\"BOOKING\",\"message\":\"Window please.\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(body, "$.id");
        assertThat(resolvedAt(id)).isNull();

        changeStatus(agent, id, "RESOLVED");
        LocalDateTime firstResolution = resolvedAt(id);
        assertThat(firstResolution).isNotNull();

        // The customer writes again: open, no longer resolved.
        mockMvc.perform(post("/api/support/tickets/" + id + "/messages").with(customer)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"Still not changed.\"}"))
                .andExpect(status().isCreated());
        assertThat(resolvedAt(id)).isNull();

        // Resolved again, then closed: the resolution is the moment it was resolved, not closed.
        changeStatus(agent, id, "RESOLVED");
        LocalDateTime resolution = resolvedAt(id);
        assertThat(resolution).isAfterOrEqualTo(firstResolution);
        changeStatus(agent, id, "CLOSED");
        assertThat(resolvedAt(id)).isEqualTo(resolution);

        // A ticket the customer closes without an answer is resolved too, and counts today.
        String other = JsonPath.read(mockMvc.perform(post("/api/support/tickets").with(customer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Never mind\",\"category\":\"OTHER\",\"message\":\"Found it.\"}"))
                .andReturn().getResponse().getContentAsString(), "$.id");
        mockMvc.perform(post("/api/support/tickets/" + other + "/close").with(customer)).andExpect(status().isOk());
        assertThat(resolvedAt(other)).isNotNull();

        mockMvc.perform(get("/api/admin/support/metrics?range=TODAY").with(agent))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interval").value("DAY"))
                .andExpect(jsonPath("$.series.length()").value(1));
        mockMvc.perform(get("/api/admin/support/metrics?range=LAST_5_YEARS&interval=DAY").with(agent))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_INTERVAL"));
        mockMvc.perform(get("/api/admin/support/metrics?range=SOMETIME").with(agent))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        mockMvc.perform(get("/api/admin/support/metrics?range=LAST_5_YEARS").with(agent))
                .andExpect(status().isOk()).andExpect(jsonPath("$.interval").value("YEAR"));
        mockMvc.perform(get("/api/admin/support/metrics").with(customer)).andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------ the source data

    /** A ticket opened by its customer; {@code replyAfter}: minutes until a message of {@code replyRole}. */
    private void ticket(String status, String category, Instant createdAt, Instant resolvedAt, Integer replyAfter,
            String replyRole) {
        UUID id = UUID.randomUUID();
        String number = "TK-" + id.toString().replace("-", "").substring(0, 8).toUpperCase();
        Instant closedAt = status.equals("CLOSED") ? resolvedAt : null;
        jdbcClient.sql("""
                        INSERT INTO support_tickets (id, ticket_number, user_id, customer_email, subject, category,
                            status, priority, last_message_at, last_message_by, closed_at, resolved_at, created_at,
                            updated_at, created_by, updated_by)
                        VALUES (UUID_TO_BIN(:id), :number, UUID_TO_BIN(UUID()), 'metrics@example.com', 'Metrics test',
                            :category, :status, 'NORMAL', :created, 'CUSTOMER', :closed, :resolved, :created, :created,
                            'test', 'test')""")
                .param("id", id.toString()).param("number", number).param("category", category)
                .param("status", status).param("created", utc(createdAt)).param("closed", utc(closedAt))
                .param("resolved", utc(resolvedAt))
                .update();
        message(id, "CUSTOMER", createdAt);
        message(id, "SYSTEM", createdAt.plusSeconds(1));   // never an answer
        Instant reply = replyAfter == null ? null : createdAt.plus(replyAfter, ChronoUnit.MINUTES);
        boolean staff = "SUPPORT_AGENT".equals(replyRole) || "ADMIN".equals(replyRole);
        if (reply != null) {
            message(id, replyRole, reply);
            if (staff) {
                message(id, "SUPPORT_AGENT", reply.plus(1, ChronoUnit.DAYS));   // later answers do not matter
            }
        }
        tickets.add(new Ticket(status, category, createdAt, resolvedAt, staff ? reply : null));
    }

    private void message(UUID ticketId, String role, Instant at) {
        jdbcClient.sql("""
                        INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_role, message, created_at)
                        VALUES (UUID_TO_BIN(UUID()), UUID_TO_BIN(:ticket), 'someone', :role, 'Hello', :at)""")
                .param("ticket", ticketId.toString()).param("role", role).param("at", utc(at)).update();
    }

    // ------------------------------------------------------------------ helpers

    private static BigDecimal averageMinutes(List<Ticket> tickets) {
        List<Ticket> answered = tickets.stream().filter(t -> t.firstReply() != null).toList();
        return BigDecimal.valueOf(answered.stream()
                        .mapToLong(t -> Duration.between(t.createdAt(), t.firstReply()).toSeconds()).sum())
                .divide(BigDecimal.valueOf(answered.size() * 60L), 1, RoundingMode.HALF_UP);
    }

    private String metrics(JwtRequestPostProcessor agent, String query) throws Exception {
        return mockMvc.perform(get("/api/admin/support/metrics?" + query).with(agent))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private void changeStatus(JwtRequestPostProcessor agent, String id, String status) throws Exception {
        mockMvc.perform(patch("/api/admin/support/tickets/" + id + "/status").with(agent)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"" + status + "\"}"))
                .andExpect(status().isOk());
    }

    private LocalDateTime resolvedAt(String id) {
        return jdbcClient.sql("SELECT resolved_at FROM support_tickets WHERE id = UUID_TO_BIN(:id)")
                .param("id", id).query(LocalDateTime.class).optional().orElse(null);
    }

    private static boolean in(Instant at, LocalDate from, LocalDate to) {
        if (at == null) {
            return false;
        }
        LocalDate day = at.atZone(INDIA).toLocalDate();
        return !day.isBefore(from) && !day.isAfter(to);
    }

    private static Instant india(String localDateTime) {
        return LocalDateTime.parse(localDateTime).atZone(INDIA).toInstant();
    }

    private static LocalDateTime utc(Instant instant) {
        return instant == null ? null : LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static long count(String json, String path) {
        return ((Number) JsonPath.read(json, path)).longValue();
    }

    private static BigDecimal money(String json, String path) {
        return new BigDecimal(JsonPath.read(json, path).toString());
    }

    private static JwtRequestPostProcessor agent() {
        UUID id = UUID.randomUUID();
        return user(id, "agent-" + id + "@example.com", Set.of("SUPPORT_AGENT"),
                Set.of("BOOKING_READ_ANY", "SUPPORT_TICKET_MANAGE"));
    }
}
