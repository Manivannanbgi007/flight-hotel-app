package com.flighthotel.assistant.grounding;

import java.util.Collection;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;

/**
 * What the tool results of one conversation contained: identifiers (booking references, ticket numbers, PNRs,
 * confirmation numbers, e-ticket numbers) and amounts. The grounding check only lets an answer name these.
 * Thread-safe: tools add to it on the tool thread while the answer is checked on the stream thread.
 */
public final class Facts {

    private final Set<String> identifiers = ConcurrentHashMap.newKeySet();
    private final Set<String> amounts = ConcurrentHashMap.newKeySet();

    public static Facts of(Collection<String> identifiers, Collection<String> amounts) {
        Facts facts = new Facts();
        facts.identifiers.addAll(identifiers);
        facts.amounts.addAll(amounts);
        return facts;
    }

    /** Adds everything that looks like an identifier or a number in a tool result. */
    public void addFromToolResult(String toolResult) {
        if (toolResult == null || toolResult.isEmpty()) {
            return;
        }
        String text = GroundingGuard.normalise(toolResult);
        identifiers.addAll(GroundingGuard.identifiersInSource(text));
        amounts.addAll(GroundingGuard.numbersInSource(text));
    }

    /**
     * Identifiers the user typed may be repeated ("I cannot cancel HT-7K3M9Q2X here"): that is not invented data.
     * Amounts the user typed are not added: the answer must never confirm an amount that no tool returned.
     */
    public void addIdentifiersFromUser(String userText) {
        if (userText != null && !userText.isEmpty()) {
            identifiers.addAll(GroundingGuard.identifiersInAnswer(GroundingGuard.normalise(userText)));
        }
    }

    public boolean hasIdentifier(String identifier) {
        return identifiers.contains(identifier);
    }

    public boolean hasAmount(String canonicalAmount) {
        return amounts.contains(canonicalAmount);
    }

    public Set<String> identifiers() {
        return new TreeSet<>(identifiers);
    }

    public Set<String> amounts() {
        return new TreeSet<>(amounts);
    }

    public boolean isEmpty() {
        return identifiers.isEmpty() && amounts.isEmpty();
    }
}
