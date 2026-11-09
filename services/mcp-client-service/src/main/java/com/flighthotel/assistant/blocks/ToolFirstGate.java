package com.flighthotel.assistant.blocks;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.IntSupplier;

import reactor.core.publisher.Flux;

/**
 * The tool-first rule. When a question asks for live data of the account and the model has not called a tool, whatever it
 * writes is memory, not data. So while no tool has been called the text is held back; once a tool is called the held text
 * (a preamble such as "Let me check") is dropped and the answer streams as usual. If the answer ends without any tool
 * call, the held text is replaced by a short honest message. Questions that do not need data pass through untouched.
 */
public final class ToolFirstGate {

    /** Shown instead of an answer that was not based on a lookup. Contains no reference, number or amount. */
    public static final String NOT_LOOKED_UP = "I can only answer that from your live account data, and the lookup did "
            + "not run, so I do not want to guess. Please ask again, for example \"Show my upcoming trips\".";

    private ToolFirstGate() {
    }

    /**
     * @param required       the question needs a lookup ({@link Intent#needsData})
     * @param toolCallsMade  how many tools the model called so far (also failed or refused calls)
     * @param onViolation    called once when an answer ended without a lookup (for the log)
     */
    public static Flux<String> apply(Flux<String> text, boolean required, IntSupplier toolCallsMade, Runnable onViolation) {
        if (!required) {
            return text;
        }
        AtomicBoolean released = new AtomicBoolean();
        return text
                .filter(chunk -> {
                    if (released.get()) {
                        return true;
                    }
                    if (toolCallsMade.getAsInt() > 0) {
                        released.set(true);
                        return true;
                    }
                    return false;
                })
                .concatWith(Flux.defer(() -> {
                    if (toolCallsMade.getAsInt() > 0) {
                        return Flux.empty();
                    }
                    onViolation.run();
                    return Flux.just(NOT_LOOKED_UP);
                }));
    }
}
