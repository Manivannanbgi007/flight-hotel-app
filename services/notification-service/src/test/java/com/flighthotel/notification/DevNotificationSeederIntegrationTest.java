package com.flighthotel.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.TreeMap;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;

import com.flighthotel.common.dev.DevIds;
import com.flighthotel.common.dev.DevScenario;
import com.flighthotel.notification.devseed.DevNotificationSeeder;

/**
 * The development notifications and support tickets: read and unread bell entries, tickets in every working state with
 * their conversations and the agent assigned, booking contacts, and no e-mail or reminder from seed data; never twice;
 * never when the switch is off or the prod profile is active. The seeder is created by hand (the shared test context
 * runs with the switch off) and its rows are removed after each test.
 */
class DevNotificationSeederIntegrationTest extends NotificationIntegrationTest {

    @Autowired
    ConfigurableApplicationContext context;

    @BeforeEach
    @AfterEach
    void removeDevRows() {
        String customers = "(" + hex(DevScenario.CUSTOMER1.id()) + "," + hex(DevScenario.CUSTOMER2.id()) + ")";
        jdbcClient.sql("DELETE FROM support_ticket_messages WHERE ticket_id IN "
                + "(SELECT id FROM support_tickets WHERE user_id IN " + customers + ")").update();
        jdbcClient.sql("DELETE FROM support_tickets WHERE user_id IN " + customers).update();
        jdbcClient.sql("DELETE FROM notifications WHERE source_event_id LIKE 'dev-seed:%'").update();
        jdbcClient.sql("DELETE FROM booking_contacts WHERE booking_reference LIKE '%-DEV%'").update();
        jdbcClient.sql("DELETE FROM notification_preferences WHERE user_id IN " + customers).update();
        jdbcClient.sql("DELETE FROM newsletter_subscriptions WHERE email LIKE 'dev.%@flighthotel.local'").update();
    }

    private static String hex(java.util.UUID id) {
        return "UNHEX('" + java.util.HexFormat.of().formatHex(DevIds.bytes(id)) + "')";
    }

    private void seed() {
        context.getAutowireCapableBeanFactory().createBean(DevNotificationSeeder.class).run(null);
    }

    private long count(String sql) {
        return jdbcClient.sql(sql).query(Long.class).single();
    }

    @Test
    void ticketsExistInEveryWorkingStateWithTheirConversationsAndAgent() throws Exception {
        long emailsBefore = count("SELECT COUNT(*) FROM email_messages");
        long snapshotsBefore = count("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'support'");

        seed();

        Map<String, Long> byStatus = new TreeMap<>();
        jdbcClient.sql("SELECT status, COUNT(*) AS n FROM support_tickets WHERE user_id IN (" + hex(DevScenario.CUSTOMER1.id())
                        + "," + hex(DevScenario.CUSTOMER2.id()) + ") GROUP BY status")
                .query((rs, i) -> byStatus.put(rs.getString("status"), rs.getLong("n"))).list();
        assertThat(byStatus).containsEntry("OPEN", 2L).containsEntry("IN_PROGRESS", 1L)
                .containsEntry("RESOLVED", 1L).containsEntry("WAITING_CUSTOMER", 1L).containsEntry("ESCALATED", 1L);
        // Worked tickets belong to the dev support agent; fresh ones wait in the queue; every ticket has a conversation.
        assertThat(count("SELECT COUNT(*) FROM support_tickets WHERE assigned_agent_id = "
                + hex(DevScenario.SUPPORT1.id()))).isEqualTo(4);
        assertThat(count("SELECT COUNT(*) FROM support_tickets WHERE status = 'OPEN' AND assigned_agent_id IS NULL "
                + "AND user_id IN (" + hex(DevScenario.CUSTOMER1.id()) + "," + hex(DevScenario.CUSTOMER2.id()) + ")"))
                .isEqualTo(2);
        assertThat(count("SELECT COUNT(*) FROM support_tickets t WHERE t.user_id IN (" + hex(DevScenario.CUSTOMER1.id())
                + "," + hex(DevScenario.CUSTOMER2.id()) + ") AND NOT EXISTS (SELECT 1 FROM support_ticket_messages m "
                + "WHERE m.ticket_id = t.id)")).isZero();
        assertThat(count("SELECT COUNT(*) FROM support_tickets WHERE status = 'RESOLVED' AND resolved_at IS NOT NULL "
                + "AND user_id = " + hex(DevScenario.CUSTOMER1.id()))).isEqualTo(1);

        // The real agent queue lists a seeded ticket.
        String number = DevIds.code("TK-", "t2", 8);
        mockMvc.perform(get("/api/admin/support/tickets?q=" + number).with(supportAgent()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].status").value("IN_PROGRESS"));
        // Each new ticket's snapshot is published (support.events, for the support search).
        assertThat(count("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'support'") - snapshotsBefore)
                .isEqualTo(count("SELECT COUNT(*) FROM support_tickets WHERE user_id IN ("
                        + hex(DevScenario.CUSTOMER1.id()) + "," + hex(DevScenario.CUSTOMER2.id()) + ")"));
        // Nothing was e-mailed and no reminder was scheduled by the seed.
        assertThat(count("SELECT COUNT(*) FROM email_messages")).isEqualTo(emailsBefore);
        assertThat(count("SELECT COUNT(*) FROM upcoming_trips WHERE booking_reference LIKE '%-DEV%'")).isZero();
    }

    @Test
    void customersHaveReadAndUnreadNotificationsAndBookingContactsExist() throws Exception {
        seed();

        for (DevScenario.Person customer : new DevScenario.Person[] {DevScenario.CUSTOMER1, DevScenario.CUSTOMER2}) {
            long unread = count("SELECT COUNT(*) FROM notifications WHERE read_at IS NULL AND user_id = "
                    + hex(customer.id()));
            long read = count("SELECT COUNT(*) FROM notifications WHERE read_at IS NOT NULL AND user_id = "
                    + hex(customer.id()));
            assertThat(unread).isPositive();
            assertThat(read).isPositive();
            mockMvc.perform(get("/api/notifications/unread-count").with(customer(customer.id(), customer.email())))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.count").value(unread));
        }
        assertThat(count("SELECT COUNT(DISTINCT category) FROM notifications WHERE source_event_id LIKE 'dev-seed:%'"))
                .isEqualTo(6);
        assertThat(count("SELECT COUNT(*) FROM booking_contacts WHERE booking_reference LIKE '%-DEV%'"))
                .isEqualTo(DevScenario.STAYS.size() + DevScenario.TRIPS.size());
    }

    @Test
    void aSecondRunCreatesNothingNew() {
        seed();
        long notifications = count("SELECT COUNT(*) FROM notifications");
        long tickets = count("SELECT COUNT(*) FROM support_tickets");
        long messages = count("SELECT COUNT(*) FROM support_ticket_messages");
        long contacts = count("SELECT COUNT(*) FROM booking_contacts");
        long snapshots = count("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'support'");

        seed();

        assertThat(count("SELECT COUNT(*) FROM notifications")).isEqualTo(notifications);
        assertThat(count("SELECT COUNT(*) FROM support_tickets")).isEqualTo(tickets);
        assertThat(count("SELECT COUNT(*) FROM support_ticket_messages")).isEqualTo(messages);
        assertThat(count("SELECT COUNT(*) FROM booking_contacts")).isEqualTo(contacts);
        assertThat(count("SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'support'")).isEqualTo(snapshots);
    }

    @Test
    void nothingIsCreatedWhenTheSwitchIsOffOrTheProdProfileIsActive() {
        assertThat(context.getBeansOfType(DevNotificationSeeder.class)).isEmpty();

        ConfigurableEnvironment environment = context.getEnvironment();
        String[] profiles = environment.getActiveProfiles();
        environment.setActiveProfiles("prod");
        try {
            seed();
        } finally {
            environment.setActiveProfiles(profiles);
        }
        assertThat(count("SELECT COUNT(*) FROM notifications WHERE source_event_id LIKE 'dev-seed:%'")).isZero();
        assertThat(count("SELECT COUNT(*) FROM support_tickets WHERE user_id IN (" + hex(DevScenario.CUSTOMER1.id())
                + "," + hex(DevScenario.CUSTOMER2.id()) + ")")).isZero();
    }
}
