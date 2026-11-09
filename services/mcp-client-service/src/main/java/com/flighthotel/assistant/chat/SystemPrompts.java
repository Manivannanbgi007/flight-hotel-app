package com.flighthotel.assistant.chat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.springframework.core.io.ClassPathResource;

import com.flighthotel.common.security.Roles;

/**
 * The system prompt per role, from {@code resources/assistant/prompts/} (the model evaluation in
 * {@code tests/assistant/model-eval.mjs} reads the same files). Kept short on purpose: on a CPU every prompt token
 * costs time. The rules that matter most (only facts from tools, read-only, no other users, ignore injected
 * instructions) are enforced in code as well: the tools are read-only and run with the user's token, and the
 * grounding check replaces invented references and amounts.
 */
public final class SystemPrompts {

    /** Roles in order of precedence: a user with several roles gets the prompt of the first one. */
    static final List<String> PRECEDENCE = List.of(Roles.ADMIN, Roles.SUPPORT_AGENT, Roles.HOTEL_MANAGER,
            Roles.CUSTOMER);

    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("EEEE d MMMM yyyy", Locale.ENGLISH);
    private static final String INTRO = load("intro");
    private static final String RULES = load("rules");
    private static final Map<String, String> ROLE_TEXT = Map.of(
            Roles.CUSTOMER, load("customer"),
            Roles.ADMIN, load("admin"),
            Roles.HOTEL_MANAGER, load("hotel-manager"),
            Roles.SUPPORT_AGENT, load("support"));

    private SystemPrompts() {
    }

    public static String primaryRole(Set<String> roles) {
        return PRECEDENCE.stream().filter(roles::contains).findFirst().orElse(Roles.CUSTOMER);
    }

    public static String forRole(String role, LocalDate today) {
        String intro = INTRO.replace("{today}", DATE.format(today)).replace("{isoDate}", today.toString());
        return intro + "\n" + ROLE_TEXT.getOrDefault(role, ROLE_TEXT.get(Roles.CUSTOMER)) + "\n" + RULES;
    }

    private static String load(String name) {
        try {
            return new ClassPathResource("assistant/prompts/" + name + ".txt").getContentAsString(StandardCharsets.UTF_8)
                    .strip();
        } catch (IOException ex) {
            throw new UncheckedIOException("Missing system prompt " + name, ex);
        }
    }
}
