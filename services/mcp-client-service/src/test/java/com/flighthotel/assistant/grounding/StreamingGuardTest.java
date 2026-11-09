package com.flighthotel.assistant.grounding;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

/** The check while the answer streams: nothing unverified ever reaches the browser. */
class StreamingGuardTest {

    private static List<StreamingGuard.Output> feed(StreamingGuard guard, String... chunks) {
        List<StreamingGuard.Output> out = new ArrayList<>();
        for (String chunk : chunks) {
            out.addAll(guard.accept(chunk));
        }
        out.addAll(guard.finish());
        return out;
    }

    private static String shown(List<StreamingGuard.Output> outputs) {
        StringBuilder text = new StringBuilder();
        for (StreamingGuard.Output output : outputs) {
            switch (output) {
                case StreamingGuard.Delta delta -> text.append(delta.text());
                case StreamingGuard.Replace replace -> {
                    text.setLength(0);
                    text.append(replace.text());
                }
            }
        }
        return text.toString();
    }

    @Test
    void aGroundedAnswerPassesUnchangedInPieces() {
        Facts facts = Facts.of(List.of("HT-7K3M9Q2X"), List.of("6300"));
        StreamingGuard guard = new StreamingGuard(facts);

        List<StreamingGuard.Output> outputs = feed(guard, "Your ", "booking ", "HT-7K", "3M9Q2X ", "costs ", "₹6,",
                "300 in ", "total.\nEnjoy ", "your trip!");

        assertThat(shown(outputs)).isEqualTo("Your booking HT-7K3M9Q2X costs ₹6,300 in total.\nEnjoy your trip!");
        assertThat(outputs).hasSizeGreaterThan(2).allMatch(StreamingGuard.Delta.class::isInstance);
        assertThat(guard.replaced()).isFalse();
        assertThat(guard.finalText()).isEqualTo("Your booking HT-7K3M9Q2X costs ₹6,300 in total.\nEnjoy your trip!");
    }

    @Test
    void anInventedValueIsNeverReleasedEvenInParts() {
        StreamingGuard guard = new StreamingGuard(new Facts());

        List<StreamingGuard.Output> outputs = feed(guard, "Sure. ", "Your ", "booking ", "HT-AB", "CD2345 ", "is ",
                "confirmed ", "and ", "more ", "text ", "follows.");

        String released = outputs.stream().filter(StreamingGuard.Delta.class::isInstance)
                .map(o -> ((StreamingGuard.Delta) o).text()).reduce("", String::concat);
        assertThat(released).doesNotContain("HT-").doesNotContain("CD2345");
        assertThat(outputs.getLast()).isInstanceOf(StreamingGuard.Replace.class);
        assertThat(shown(outputs)).isEqualTo(GroundingGuard.SAFE_ANSWER);
        assertThat(guard.finalText()).isEqualTo(GroundingGuard.SAFE_ANSWER);
        assertThat(guard.violation()).hasValueSatisfying(v -> assertThat(v.kind()).isEqualTo("identifier"));
        // Nothing more after the replacement.
        assertThat(guard.accept("extra")).isEmpty();
        assertThat(guard.finish()).isEmpty();
    }

    @Test
    void anAmountWithTheCurrencyAfterTheNumberIsHeldUntilItIsComplete() {
        StreamingGuard guard = new StreamingGuard(new Facts());

        List<StreamingGuard.Output> outputs = new ArrayList<>(guard.accept("The refund is 9,999 "));
        String releasedSoFar = shown(outputs);
        outputs.addAll(guard.accept("INR today."));
        outputs.addAll(guard.finish());

        assertThat(releasedSoFar).doesNotContain("9,999");
        assertThat(shown(outputs)).isEqualTo(GroundingGuard.SAFE_ANSWER);
    }

    @Test
    void aShortAnswerIsReleasedAtTheEnd() {
        StreamingGuard guard = new StreamingGuard(new Facts());

        assertThat(guard.accept("Hello there")).isEmpty();
        assertThat(shown(guard.finish())).isEqualTo("Hello there");
    }
}
