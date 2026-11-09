package com.flighthotel.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;

import com.flighthotel.events.booking.BookingCancellationFailed;
import com.flighthotel.events.support.SupportTicketSnapshot;
import com.flighthotel.notification.ticket.SupportTicketSnapshotBackfill;
import com.jayway.jsonpath.JsonPath;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/**
 * Support tickets on {@code support.events} (search-service's read model): every change of a ticket publishes one
 * {@code SupportTicketSnapshot} with the ticket's final state of that transaction, a refused change publishes nothing,
 * and the one-time backfill publishes every existing ticket once.
 */
class SupportTicketSnapshotIntegrationTest extends NotificationIntegrationTest {

    private static final KafkaAvroDeserializer AVRO = new KafkaAvroDeserializer();

    static {
        AVRO.configure(Map.of("schema.registry.url", "mock://notification-phase8-it", "specific.avro.reader", true),
                false);
    }

    @Autowired
    SupportTicketSnapshotBackfill backfill;

    @Test
    void everyChangeOfATicketPublishesOneSnapshotWithItsFinalState() throws Exception {
        UUID me = UUID.randomUUID();
        String email = "snapshot-" + me + "@example.com";
        String opened = mockMvc.perform(post("/api/support/tickets").with(customer(me, email))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subject":"Refund status","category":"REFUND","message":"Where is it?"}"""))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(opened, "$.id");

        // Opened by the customer.
        SupportTicketSnapshot created = only(snapshots(id));
        assertThat(created.getTicketId()).isEqualTo(id);
        assertThat(created.getTicketNumber()).isEqualTo(JsonPath.read(opened, "$.ticketNumber"));
        assertThat(created.getUserId()).isEqualTo(me.toString());
        assertThat(created.getCustomerEmail()).isEqualTo(email);
        assertThat(created.getSubject()).isEqualTo("Refund status");
        assertThat(created.getCategory()).isEqualTo("REFUND");
        assertThat(created.getStatus()).isEqualTo("OPEN");
        assertThat(created.getPriority()).isEqualTo("NORMAL");
        assertThat(created.getAssignedAgentId()).isNull();
        assertThat(created.getBookingId()).isNull();
        assertThat(created.getBookingReference()).isNull();
        assertThat(created.getCreatedAt()).isNotNull();
        assertThat(created.getLastMessageAt()).isNotNull();
        assertThat(created.getResolvedAt()).isNull();
        assertThat(created.getClosedAt()).isNull();
        assertThat(created.getChangedAt()).isNotNull();

        // An agent answers an unassigned ticket: new message, waiting for the customer and taken by the agent, all in
        // one transaction, so one snapshot with all of it.
        UUID agentId = UUID.randomUUID();
        mockMvc.perform(post("/api/support/tickets/" + id + "/messages").with(agent(agentId))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"It is on its way.\"}"))
                .andExpect(status().isCreated());
        List<SupportTicketSnapshot> snapshots = snapshots(id);
        assertThat(snapshots).hasSize(2);
        SupportTicketSnapshot answered = snapshots.getLast();
        assertThat(answered.getStatus()).isEqualTo("WAITING_CUSTOMER");
        assertThat(answered.getAssignedAgentId()).isEqualTo(agentId.toString());
        assertThat(answered.getLastMessageAt()).isAfterOrEqualTo(created.getLastMessageAt());
        assertThat(answered.getCreatedAt()).isCloseTo(created.getCreatedAt(), within(1, ChronoUnit.MILLIS));
        assertThat(answered.getChangedAt()).isAfterOrEqualTo(created.getChangedAt());

        // Handed to a colleague.
        UUID colleague = UUID.randomUUID();
        mockMvc.perform(post("/api/admin/support/tickets/" + id + "/assign").with(agent(agentId))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"agentId\":\"" + colleague + "\"}"))
                .andExpect(status().isOk());
        snapshots = snapshots(id);
        assertThat(snapshots).hasSize(3);
        assertThat(snapshots.getLast().getAssignedAgentId()).isEqualTo(colleague.toString());

        // Escalated with high priority, then resolved.
        mockMvc.perform(patch("/api/admin/support/tickets/" + id + "/status").with(agent(colleague))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ESCALATED\",\"priority\":\"HIGH\"}"))
                .andExpect(status().isOk());
        snapshots = snapshots(id);
        assertThat(snapshots).hasSize(4);
        assertThat(snapshots.getLast().getStatus()).isEqualTo("ESCALATED");
        assertThat(snapshots.getLast().getPriority()).isEqualTo("HIGH");
        mockMvc.perform(patch("/api/admin/support/tickets/" + id + "/status").with(agent(colleague))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"RESOLVED\"}"))
                .andExpect(status().isOk());
        snapshots = snapshots(id);
        assertThat(snapshots).hasSize(5);
        assertThat(snapshots.getLast().getStatus()).isEqualTo("RESOLVED");
        assertThat(snapshots.getLast().getResolvedAt()).isNotNull();
        assertThat(snapshots.getLast().getClosedAt()).isNull();

        // The customer replies (reopens it), then closes it.
        mockMvc.perform(post("/api/support/tickets/" + id + "/messages").with(customer(me, email))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"Not arrived yet.\"}"))
                .andExpect(status().isCreated());
        snapshots = snapshots(id);
        assertThat(snapshots).hasSize(6);
        assertThat(snapshots.getLast().getStatus()).isEqualTo("OPEN");
        assertThat(snapshots.getLast().getResolvedAt()).isNull();
        mockMvc.perform(post("/api/support/tickets/" + id + "/close").with(customer(me, email)))
                .andExpect(status().isOk());
        snapshots = snapshots(id);
        assertThat(snapshots).hasSize(7);
        assertThat(snapshots.getLast().getStatus()).isEqualTo("CLOSED");
        assertThat(snapshots.getLast().getClosedAt()).isNotNull();
        assertThat(snapshots.getLast().getResolvedAt()).isNotNull();

        // Refused changes publish nothing: replying to or reopening a closed ticket, closing it again.
        mockMvc.perform(post("/api/support/tickets/" + id + "/messages").with(customer(me, email))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"Hello?\"}"))
                .andExpect(status().isConflict());
        mockMvc.perform(patch("/api/admin/support/tickets/" + id + "/status").with(agent(colleague))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"OPEN\"}"))
                .andExpect(status().isConflict());
        mockMvc.perform(post("/api/support/tickets/" + id + "/close").with(customer(me, email)))
                .andExpect(status().isOk());
        assertThat(snapshots(id)).hasSize(7);

        // Routed like every outbox event: aggregate type → topic support.events, key = ticket id, Avro type in a header.
        assertThat(jdbcClient.sql("SELECT DISTINCT event_type FROM outbox_events WHERE aggregate_type = 'support' "
                        + "AND aggregate_id = :id").param("id", id).query(String.class).list())
                .containsExactly(SupportTicketSnapshot.class.getName());
    }

    @Test
    void aTicketOpenedForARefusedCancellationIsPublishedOnce() throws Exception {
        UUID me = UUID.randomUUID();
        UUID bookingId = UUID.randomUUID();
        String event = eventId();
        BookingCancellationFailed failed = BookingCancellationFailed.newBuilder()
                .setBookingId(bookingId.toString()).setBookingReference("FL-SNAP0001").setBookingType("FLIGHT")
                .setUserId(me.toString()).setCancellationId(UUID.randomUUID().toString()).setTitle("Delhi to Mumbai")
                .setContactEmail("snap-" + me + "@example.com").setCustomerName("Asha Rao").setReason("NOT_ALLOWED")
                .setMessage("The airline does not allow this booking to be cancelled online.")
                .setFailedAt(Instant.now()).build();

        notificationsListener.handleBookingEvent(event, failed);
        notificationsListener.handleBookingEvent(event, failed);   // redelivered: handled once

        String id = jdbcClient.sql("SELECT BIN_TO_UUID(id) FROM support_tickets WHERE source_event_id = :event")
                .param("event", event).query(String.class).single();
        SupportTicketSnapshot snapshot = only(snapshots(id));
        assertThat(snapshot.getUserId()).isEqualTo(me.toString());
        assertThat(snapshot.getCustomerEmail()).isEqualTo("snap-" + me + "@example.com");
        assertThat(snapshot.getBookingId()).isEqualTo(bookingId.toString());
        assertThat(snapshot.getBookingReference()).isEqualTo("FL-SNAP0001");
        assertThat(snapshot.getCategory()).isEqualTo("CANCELLATION");
        assertThat(snapshot.getPriority()).isEqualTo("HIGH");
        assertThat(snapshot.getStatus()).isEqualTo("OPEN");
    }

    @Test
    void theBackfillPublishesEveryTicketOnceAndOnlyOnce() throws Exception {
        UUID me = UUID.randomUUID();
        String opened = mockMvc.perform(post("/api/support/tickets").with(customer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Backfill\",\"category\":\"OTHER\",\"message\":\"Hello.\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(opened, "$.id");
        // Already run once when the application started.
        assertThat(backfillDone()).isTrue();
        long tickets = jdbcClient.sql("SELECT COUNT(*) FROM support_tickets").query(Long.class).single();
        jdbcClient.sql("UPDATE data_backfills SET done_at = NULL WHERE name = 'support-ticket-snapshots'").update();
        long before = snapshotRows();

        backfill.onStart();
        backfill.onStart();   // already done: nothing more

        assertThat(snapshotRows() - before).isEqualTo(tickets);
        List<SupportTicketSnapshot> snapshots = snapshots(id);
        assertThat(snapshots).hasSize(2);   // its own at creation + the backfill's
        assertThat(snapshots.getLast().getTicketId()).isEqualTo(id);
        assertThat(snapshots.getLast().getStatus()).isEqualTo("OPEN");
        assertThat(snapshots.getLast().getSubject()).isEqualTo("Backfill");
        assertThat(backfillDone()).isTrue();
    }

    // ------------------------------------------------------------------ helpers

    private static JwtRequestPostProcessor agent(UUID id) {
        return user(id, "agent-" + id + "@example.com", Set.of("SUPPORT_AGENT"),
                Set.of("BOOKING_READ_ANY", "SUPPORT_TICKET_MANAGE"));
    }

    /** The ticket's snapshots in the outbox, oldest first, decoded like a Kafka consumer would. */
    private List<SupportTicketSnapshot> snapshots(String ticketId) {
        return jdbcClient.sql("""
                        SELECT payload FROM outbox_events WHERE aggregate_type = 'support' AND aggregate_id = :id
                        ORDER BY created_at, id""")
                .param("id", ticketId)
                .query((rs, i) -> (SupportTicketSnapshot) AVRO.deserialize("support.events", rs.getBytes("payload")))
                .list();
    }

    private boolean backfillDone() {
        return jdbcClient.sql("SELECT done_at IS NOT NULL FROM data_backfills WHERE name = 'support-ticket-snapshots'")
                .query(Boolean.class).single();
    }

    private long snapshotRows() {
        return jdbcClient.sql("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'support'")
                .query(Long.class).single();
    }

    private static SupportTicketSnapshot only(List<SupportTicketSnapshot> snapshots) {
        assertThat(snapshots).hasSize(1);
        return snapshots.getFirst();
    }
}
