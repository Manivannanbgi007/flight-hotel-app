package com.flighthotel.assistant.grounding;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

/** The "no invented data" rule: references, ticket numbers, PNRs and amounts must come from tool results. */
class GroundingGuardTest {

    private static final String TOOL_RESULT = """
            {"bookings":[{"reference":"HT-7K3M9Q2X","status":"CONFIRMED","total":"₹6,300","startDate":"2026-12-01",
              "hotel":{"confirmationNumber":"H7K3M9Q2XA"}},
             {"reference":"FL-4KD8M2PQ","total":"₹2,00,000.50","flight":{"pnr":"KQXPLM","flights":["6E 2134 (IndiGo)"],
              "passengers":[{"ticketNumber":"0981234567890"}]},"refund":3150.00}],
             "tickets":[{"ticketNumber":"TK-8F3K2M9Q"}]}
            """;

    private static Facts facts() {
        Facts facts = new Facts();
        facts.addFromToolResult(TOOL_RESULT);
        return facts;
    }

    @Test
    void anAnswerUsingOnlyToolFactsIsGrounded() {
        String answer = """
                Your stay HT-7K3M9Q2X (confirmation H7K3M9Q2XA) costs ₹6,300 and your flight FL-4KD8M2PQ \
                (PNR KQXPLM, flight 6E2134, e-ticket 098-1234567890) cost ₹2,00,000.50. A cancellation refunds \
                Rs. 3,150 or 3150 INR. Ticket TK-8F3K2M9Q is open. You have 2 trips, the first on 2026-12-01 \
                for 3 nights, 50% off.""";

        assertThat(GroundingGuard.check(answer, facts())).isEmpty();
    }

    @Test
    void inventedIdentifiersAreCaught() {
        for (String answer : List.of(
                "Your booking HT-AAAA2222 is confirmed.",
                "Ticket TK-ZZZZ9999 was closed.",
                "Your PNR is X9Y8Z7.",
                "Your PNR: ABCDEF.",
                "Hotel confirmation number H123456789.",
                "Your e-ticket is 0989999999999.")) {
            assertThat(GroundingGuard.check(answer, facts())).as(answer)
                    .hasValueSatisfying(v -> assertThat(v.kind()).isEqualTo("identifier"));
        }
    }

    @Test
    void inventedAmountsAreCaughtWhateverTheFormat() {
        for (String answer : List.of("It costs ₹6,301.", "Refund of Rs 999.", "Total INR 12600.",
                "You spent 12,600 rupees.", "about ₹ 7,000", "₹6,300.01 in total", "only 450 INR")) {
            assertThat(GroundingGuard.check(answer, facts())).as(answer)
                    .hasValueSatisfying(v -> assertThat(v.kind()).isEqualTo("amount"));
        }
    }

    @Test
    void ordinaryTextIsNotMistakenForData() {
        String answer = """
                I re-checked your trips: 2 hotels and 1 flight, 3 nights from 1 December 2026 at 14:00. \
                Occupancy was 61.9% and the rating 4.5. Use the My Trips page (e-mail me if needed). \
                Flight AI 504 leaves at 06:45. Check-in is open 24 hours. COVID-free, Wi-Fi included.""";

        assertThat(GroundingGuard.check(answer, new Facts())).isEmpty();
    }

    @Test
    void identifiersAreComparedNormalised() {
        Facts facts = Facts.of(List.of("HT-7K3M9Q2X"), List.of("6300"));

        assertThat(GroundingGuard.check("booking ht-7k3m9q2x", facts)).isEmpty();
        assertThat(GroundingGuard.check("₹6,300.00", facts)).isEmpty();
        assertThat(GroundingGuard.check("₹ 6300", facts)).isEmpty();
    }

    @Test
    void referencesTheUserTypedMayBeRepeatedButNotTheirAmounts() {
        Facts facts = new Facts();
        facts.addIdentifiersFromUser("Cancel HT-7K3M9Q2X now, my refund is ₹5,000 right?");

        assertThat(GroundingGuard.check("I can't cancel HT-7K3M9Q2X here; use My Trips.", facts)).isEmpty();
        assertThat(GroundingGuard.check("Yes, your refund is ₹5,000.", facts))
                .hasValueSatisfying(v -> assertThat(v.kind()).isEqualTo("amount"));
        assertThat(GroundingGuard.check("Your other booking HT-AAAA2222 is fine.", facts)).isPresent();
    }

    @Test
    void typographicHyphensAndSpacesCannotHideAValue() {
        // U+2011 non-breaking hyphen, U+202F narrow no-break space, full-width digits.
        assertThat(GroundingGuard.check("Your booking HT‑AAAA2222 is confirmed.", facts())).isPresent();
        assertThat(GroundingGuard.check("It costs ₹ 9,999.", facts())).isPresent();
        assertThat(GroundingGuard.check("Ticket TK‑8F3K2M9Q costs ₹６,３００.", facts()))
                .isEmpty();
        assertThat(GroundingGuard.check("Your stay HT‑7K3M9Q2X.", facts())).isEmpty();
    }

    @Test
    void anEmptyConversationAllowsNoFacts() {
        assertThat(GroundingGuard.check("Your booking HT-7K3M9Q2X costs ₹6,300.", new Facts())).isPresent();
        assertThat(GroundingGuard.check("Hello! How can I help with your trips?", new Facts())).isEmpty();
    }

    @Test
    void violationsNeverPrintTheValue() {
        assertThat(GroundingGuard.check("HT-AAAA2222", new Facts()).orElseThrow().toString())
                .doesNotContain("HT-AAAA2222");
    }
}
