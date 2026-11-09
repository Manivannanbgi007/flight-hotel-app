package com.flighthotel.assistant.grounding;

import java.util.List;
import java.util.Optional;

/**
 * Applies {@link GroundingGuard} while the answer streams. Text is released only up to a word boundary, and the last
 * {@value #HELD_WORDS} words are held back until the next ones arrive, so a reference or an amount ("6,300 INR") is
 * always checked complete <b>before</b> any part of it reaches the browser. When something is not grounded, the
 * stream stops and the answer is replaced; the made-up value itself is never shown.
 * <p>
 * Not thread-safe: one instance per answer, fed from one stream.
 */
public final class StreamingGuard {

    static final int HELD_WORDS = 2;

    /** What to send to the browser. */
    public sealed interface Output permits Delta, Replace {
    }

    /** More text of the answer. */
    public record Delta(String text) implements Output {
    }

    /** Throw away what was shown so far and show this instead (the safe answer). */
    public record Replace(String text, GroundingGuard.Violation violation) implements Output {
    }

    private final Facts facts;
    private final StringBuilder text = new StringBuilder();
    private int released;
    private Replace replacement;

    public StreamingGuard(Facts facts) {
        this.facts = facts;
    }

    /** Takes the next piece of the model's answer; returns what may be shown now (possibly nothing). */
    public List<Output> accept(String chunk) {
        if (replacement != null || chunk == null || chunk.isEmpty()) {
            return List.of();
        }
        text.append(chunk);
        // Check all complete words (also the held ones: "9,999" is only an amount once "INR" follows it). The last
        // word may still be growing ("₹6,3" of "₹6,300"), so it waits.
        if (violated(completeWordsEnd())) {
            return List.of(replacement);
        }
        int cut = safeCut();
        if (cut <= released) {
            return List.of();
        }
        String delta = text.substring(released, cut);
        released = cut;
        return List.of(new Delta(delta));
    }

    /** The answer is complete: check and release the rest. */
    public List<Output> finish() {
        if (replacement != null) {
            return List.of();
        }
        if (violated(text.length())) {
            return List.of(replacement);
        }
        if (text.length() <= released) {
            return List.of();
        }
        String delta = text.substring(released);
        released = text.length();
        return List.of(new Delta(delta));
    }

    /** The answer as the user saw it in the end (for the conversation memory). */
    public String finalText() {
        return replacement != null ? replacement.text() : text.toString().strip();
    }

    public boolean replaced() {
        return replacement != null;
    }

    public Optional<GroundingGuard.Violation> violation() {
        return replacement == null ? Optional.empty() : Optional.of(replacement.violation());
    }

    private boolean violated(int end) {
        Optional<GroundingGuard.Violation> violation = GroundingGuard.check(text.substring(0, end), facts);
        violation.ifPresent(v -> replacement = new Replace(GroundingGuard.SAFE_ANSWER, v));
        return violation.isPresent();
    }

    /** The end of the last whitespace: everything before it is complete words. */
    private int completeWordsEnd() {
        for (int i = text.length() - 1; i >= 0; i--) {
            if (Character.isWhitespace(text.charAt(i))) {
                return i + 1;
            }
        }
        return 0;
    }

    /** The end of the last whitespace run before the last {@value #HELD_WORDS} words. */
    private int safeCut() {
        int words = 0;
        int i = text.length() - 1;
        // Ignore a trailing partial word: it counts as one of the held words.
        boolean inWord = false;
        for (; i >= 0; i--) {
            boolean space = Character.isWhitespace(text.charAt(i));
            if (!space && !inWord) {
                inWord = true;
                words++;
            } else if (space && inWord) {
                inWord = false;
                if (words >= HELD_WORDS) {
                    // i is the whitespace before the held words: release up to and including it.
                    return i + 1;
                }
            }
        }
        return 0;
    }
}
