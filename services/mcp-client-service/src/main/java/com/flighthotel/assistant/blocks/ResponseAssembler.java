package com.flighthotel.assistant.blocks;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.flighthotel.assistant.grounding.Facts;
import com.flighthotel.assistant.grounding.GroundingGuard;

/**
 * Builds the structured part of an answer (cards and buttons) and checks it before it leaves the server:
 * <ul>
 * <li>the cards come from the tool results, so their values are the backend's own; as a second line of defence every
 * card's text goes through the grounding check against the conversation's facts, and a card that names an unknown
 * reference, ticket number, code or amount is dropped;</li>
 * <li>every button must be a route of the allowlist that the user's roles may be shown, and a hotel name on a button must
 * be a hotel a tool returned; anything else is dropped.</li>
 * </ul>
 * Logs say what was dropped, never the content.
 */
public final class ResponseAssembler {

    private static final Logger log = LoggerFactory.getLogger(ResponseAssembler.class);
    private static final int MAX_BLOCKS = 6;

    /** The cards and buttons of one answer. */
    public record Result(List<ChatBlock> blocks, List<ChatAction> actions) {

        public Result {
            blocks = blocks == null ? List.of() : List.copyOf(blocks);
            actions = actions == null ? List.of() : List.copyOf(actions);
        }
    }

    private ResponseAssembler() {
    }

    public static Result assemble(String role, Set<String> roles, String question, List<ToolRun> runs, Facts facts) {
        List<ChatBlock> blocks = new ArrayList<>();
        ChatBlock steps = ActionPlanner.steps(role, question);
        if (steps != null) {
            blocks.add(steps);
        }
        for (ToolRun run : runs) {
            try {
                blocks.addAll(BlockBuilder.build(run.tool(), run.result()));
            } catch (RuntimeException ex) {
                log.warn("Assistant card could not be built: tool={} error={}", run.tool(), ex.getClass().getSimpleName());
            }
        }
        List<ChatBlock> checked = new ArrayList<>();
        for (ChatBlock block : blocks) {
            if (checked.size() >= MAX_BLOCKS) {
                break;
            }
            if (grounded(block, facts)) {
                checked.add(block);
            } else {
                log.warn("Assistant card dropped by the grounding check: type={}", block.type());
            }
        }
        List<ChatAction> actions = new ArrayList<>();
        for (ChatAction action : ActionPlanner.plan(role, roles, question, runs)) {
            if (permitted(action, roles)) {
                actions.add(action);
            } else {
                log.warn("Assistant button dropped: route={}", action.route());
            }
        }
        return new Result(checked, actions);
    }

    /** A button is shown only for a known route key that the roles may see. */
    static boolean permitted(ChatAction action, Set<String> roles) {
        return Route.parse(action.route()).filter(route -> route.allowedFor(roles))
                .filter(route -> route.hotelScoped() || action.hotel() == null).isPresent();
    }

    static boolean grounded(ChatBlock block, Facts facts) {
        return GroundingGuard.check(text(block), facts).isEmpty();
    }

    /** All the words and numbers a card shows, as one text for the grounding check. */
    static String text(ChatBlock block) {
        StringBuilder out = new StringBuilder();
        append(out, block.title());
        append(out, block.summary());
        block.items().forEach(item -> {
            append(out, item.title());
            append(out, item.subtitle());
            append(out, item.badge());
            item.fields().forEach(field -> append(out, field.value()));
        });
        block.metrics().forEach(metric -> append(out, metric.value()));
        block.sections().forEach(section -> section.fields().forEach(field -> append(out, field.value())));
        block.rows().forEach(row -> row.forEach(cell -> append(out, cell)));
        block.steps().forEach(step -> append(out, step));
        return out.toString();
    }

    private static void append(StringBuilder out, String value) {
        if (value != null) {
            out.append(value).append('\n');
        }
    }
}
