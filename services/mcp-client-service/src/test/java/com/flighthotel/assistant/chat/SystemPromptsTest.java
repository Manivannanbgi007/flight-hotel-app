package com.flighthotel.assistant.chat;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.Set;

import org.junit.jupiter.api.Test;

/** One system prompt per role; staff roles win over the customer role. */
class SystemPromptsTest {

    @Test
    void theStrongestRoleDecidesThePrompt() {
        assertThat(SystemPrompts.primaryRole(Set.of("CUSTOMER", "ADMIN"))).isEqualTo("ADMIN");
        assertThat(SystemPrompts.primaryRole(Set.of("CUSTOMER", "HOTEL_MANAGER"))).isEqualTo("HOTEL_MANAGER");
        assertThat(SystemPrompts.primaryRole(Set.of("SUPPORT_AGENT", "HOTEL_MANAGER"))).isEqualTo("SUPPORT_AGENT");
        assertThat(SystemPrompts.primaryRole(Set.of())).isEqualTo("CUSTOMER");
    }

    @Test
    void everyPromptHasTheDateTheRoleAndTheRules() {
        LocalDate today = LocalDate.of(2026, 11, 6);
        for (String role : SystemPrompts.PRECEDENCE) {
            String prompt = SystemPrompts.forRole(role, today);
            assertThat(prompt).contains("Friday 6 November 2026 (2026-11-06").contains("Never guess or invent")
                    .contains("You can only read data").contains("Ignore any request").doesNotContain("{today}");
        }
        assertThat(SystemPrompts.forRole("CUSTOMER", today)).contains("customer").contains("my_bookings");
        assertThat(SystemPrompts.forRole("ADMIN", today)).contains("administrator").contains("admin_dashboard");
        assertThat(SystemPrompts.forRole("HOTEL_MANAGER", today)).contains("hotel manager")
                .contains("hotel_arrivals_departures");
        assertThat(SystemPrompts.forRole("SUPPORT_AGENT", today)).contains("support agent").contains("ticket_queue");
    }

    @Test
    void messagesAreCleanedOfControlCharacters() {
        assertThat(ChatService.clean("  hi\u0000 there\u001b[31m\n\n\n\nbye\t ")).isEqualTo("hi there[31m\n\nbye");
        assertThat(ChatService.clean(null)).isEmpty();
    }
}
