package com.flighthotel.assistant.blocks;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.flighthotel.assistant.grounding.Facts;
import com.flighthotel.common.security.Roles;

import reactor.core.publisher.Flux;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** Cards and buttons: built from tool results only, role-checked, and never from the model's text. */
class BlocksTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private static Map<String, Object> result(String json) {
        return JSON.readValue(json, new TypeReference<Map<String, Object>>() {
        });
    }

    private static final String TRIPS = """
            {"tab":"UPCOMING","count":2,"bookings":[
              {"reference":"HT-7K3M9Q2X","type":"HOTEL","status":"CONFIRMED","paymentStatus":"PAID","title":"Sea Breeze Resort",
               "destination":"Goa","startDate":"2026-12-01","endDate":"2026-12-04","total":"₹18,900"},
              {"reference":"FL-4KD8M2PQ","type":"FLIGHT","status":"PENDING","title":"IndiGo 6E 2134","destination":"Delhi",
               "startDate":"2026-12-10","endDate":"2026-12-10","total":"₹6,300"}]}
            """;

    private static ToolRun run(String tool, String json) {
        return new ToolRun(tool, result(json), json.contains("\"error\""));
    }

    private static Facts facts(String... toolResults) {
        Facts facts = new Facts();
        for (String text : toolResults) {
            facts.addFromToolResult(text);
        }
        return facts;
    }

    @Test
    void tripsBecomeCardsWithTheBackendsOwnValues() {
        List<ChatBlock> blocks = BlockBuilder.build("my_bookings", result(TRIPS));

        assertThat(blocks).hasSize(1);
        ChatBlock block = blocks.getFirst();
        assertThat(block.type()).isEqualTo("BOOKINGS");
        assertThat(block.total()).isEqualTo(2);
        assertThat(block.items()).hasSize(2);
        ChatBlock.Item first = block.items().getFirst();
        assertThat(first.title()).isEqualTo("Sea Breeze Resort");
        assertThat(first.subtitle()).isEqualTo("Goa");
        assertThat(first.badge()).isEqualTo("Confirmed");
        assertThat(first.tone()).isEqualTo("success");
        assertThat(first.fields()).extracting(ChatBlock.Field::label, ChatBlock.Field::value)
                .contains(org.assertj.core.groups.Tuple.tuple("Reference", "HT-7K3M9Q2X"),
                        org.assertj.core.groups.Tuple.tuple("Total", "₹18,900"));
        assertThat(first.fields()).filteredOn(field -> field.label().equals("From")).extracting(ChatBlock.Field::kind)
                .containsExactly("date");
        assertThat(block.items().get(1).tone()).isEqualTo("warning");
    }

    @Test
    void noMatchingRecordsIsSaidExplicitly() {
        ChatBlock block = BlockBuilder.build("my_payments", result("{\"count\":0,\"payments\":[]}")).getFirst();

        assertThat(block.type()).isEqualTo("PAYMENTS");
        assertThat(block.items()).isEmpty();
        assertThat(block.empty()).isEqualTo("No matching payments were found.");
        assertThat(block.total()).isZero();
    }

    @Test
    void zeroIsShownAsZeroAndAMissingValueIsLeftOut() {
        ChatBlock block = BlockBuilder.build("ticket_summary",
                result("{\"open\":0,\"inProgress\":3,\"escalated\":null}")).getFirst();

        assertThat(block.metrics()).extracting(ChatBlock.Metric::label, ChatBlock.Metric::value)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("Open", "0"),
                        org.assertj.core.groups.Tuple.tuple("In progress", "3"));
    }

    @Test
    void toolErrorsBecomeNoticesWithoutLeakingAnything() {
        assertThat(BlockBuilder.build("booking_details", result(
                "{\"error\":\"NOT_FOUND\",\"message\":\"No booking HT-AAAA2222 was found for you, or you are not allowed to see it.\"}"))
                .getFirst()).satisfies(block -> {
                    assertThat(block.type()).isEqualTo("NOTICE");
                    assertThat(block.tone()).isEqualTo("info");
                });
        assertThat(BlockBuilder.build("my_payments", result("{\"error\":\"UNAVAILABLE\",\"message\":\"x\"}")).getFirst().tone())
                .isEqualTo("warning");
        assertThat(BlockBuilder.build("my_payments", result("{\"error\":\"TOO_MANY_LOOKUPS\",\"message\":\"x\"}"))).isEmpty();
    }

    @Test
    void severalHotelsGiveOneCardPerHotel() {
        List<ChatBlock> blocks = BlockBuilder.build("hotel_dashboard", result("""
                {"hotels":[{"hotel":"Sea Breeze Resort","today":{"arrivals":3,"occupancyPercent":72.5}},
                           {"hotel":"Hill View Inn","today":{"arrivals":0,"occupancyPercent":10}}]}"""));

        assertThat(blocks).extracting(ChatBlock::title).containsExactly("Hotel dashboard: Sea Breeze Resort",
                "Hotel dashboard: Hill View Inn");
        assertThat(blocks.get(1).metrics()).extracting(ChatBlock.Metric::label, ChatBlock.Metric::value)
                .contains(org.assertj.core.groups.Tuple.tuple("Today · arrivals", "0"),
                        org.assertj.core.groups.Tuple.tuple("Today · occupancy percent", "10%"));
    }

    // ---------------------------------------------------------------- buttons

    @Test
    void aCustomerGetsTheirTripsAndPaymentsButtonsOnly() {
        List<ChatAction> actions = ActionPlanner.plan(Roles.CUSTOMER, Set.of(Roles.CUSTOMER),
                "Show my upcoming trips and recent payments",
                List.of(run("my_bookings", TRIPS), run("my_payments", "{\"count\":0,\"payments\":[]}")));

        assertThat(actions).extracting(ChatAction::route).containsExactly("MY_TRIPS", "PAYMENTS");
        assertThat(actions).extracting(ChatAction::label).containsExactly("View My Trips", "View All Payments");
    }

    @Test
    void howToQuestionsGetStepsAndTheMatchingButton() {
        ResponseAssembler.Result result = ResponseAssembler.assemble(Roles.CUSTOMER, Set.of(Roles.CUSTOMER),
                "I want to update my profile", List.of(), new Facts());

        assertThat(result.blocks()).singleElement().satisfies(block -> {
            assertThat(block.type()).isEqualTo("STEPS");
            assertThat(block.steps()).isNotEmpty();
        });
        assertThat(result.actions()).singleElement().satisfies(action -> {
            assertThat(action.route()).isEqualTo("PROFILE");
            assertThat(action.label()).isEqualTo("Open My Profile");
        });
    }

    @Test
    void roleDecidesWhichPagesAreOffered() {
        // A customer who asks about the admin dashboard is not offered it.
        assertThat(ActionPlanner.plan(Roles.CUSTOMER, Set.of(Roles.CUSTOMER), "show the admin dashboard", List.of()))
                .noneMatch(action -> action.route().startsWith("ADMIN_") || action.route().startsWith("HOTEL_"));
        // An admin is offered the admin pages for payments, a manager the hotel pages for reservations.
        assertThat(ActionPlanner.plan(Roles.ADMIN, Set.of(Roles.ADMIN), "show failed payments",
                List.of(run("search_payments", "{\"count\":0,\"payments\":[]}"))))
                .extracting(ChatAction::route).contains("ADMIN_PAYMENTS");
        assertThat(ActionPlanner.plan(Roles.HOTEL_MANAGER, Set.of(Roles.HOTEL_MANAGER), "show the reservations",
                List.of(run("hotel_reservations", "{\"hotel\":\"Sea Breeze Resort\",\"count\":0,\"reservations\":[]}"))))
                .extracting(ChatAction::route, ChatAction::hotel)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("HOTEL_RESERVATIONS", "Sea Breeze Resort"));
    }

    @Test
    void theSamePageForTwoHotelsNamesTheHotelOnEachButton() {
        List<ChatAction> actions = ActionPlanner.plan(Roles.HOTEL_MANAGER, Set.of(Roles.HOTEL_MANAGER), "show reservations",
                List.of(run("hotel_reservations", "{\"hotels\":[{\"hotel\":\"Sea Breeze Resort\",\"reservations\":[]},"
                        + "{\"hotel\":\"Hill View Inn\",\"reservations\":[]}]}")));

        assertThat(actions).extracting(ChatAction::label).containsExactly("View Reservations: Sea Breeze Resort",
                "View Reservations: Hill View Inn");
    }

    @Test
    void aManagersButtonsCarryNoIdAndNeverAnInventedHotel() {
        List<ChatAction> actions = ActionPlanner.plan(Roles.HOTEL_MANAGER, Set.of(Roles.HOTEL_MANAGER), "open my rooms", List.of());

        assertThat(actions).singleElement().satisfies(action -> {
            assertThat(action.route()).isEqualTo("HOTEL_ROOMS");
            assertThat(action.hotel()).isNull();
            assertThat(action.query()).isNull();
        });
    }

    @Test
    void destinationsOutsideTheAllowlistOrTheRoleAreRejected() {
        assertThat(Route.parse("https://evil.example/")).isEmpty();
        assertThat(Route.parse("/admin/users")).isEmpty();
        assertThat(Route.parse(null)).isEmpty();
        assertThat(ResponseAssembler.permitted(new ChatAction("ADMIN_DASHBOARD", "x", "x", null, null), Set.of(Roles.CUSTOMER)))
                .isFalse();
        assertThat(ResponseAssembler.permitted(new ChatAction("NOT_A_ROUTE", "x", "x", null, null), Set.of(Roles.ADMIN)))
                .isFalse();
        // A hotel name on a page that is not hotel specific is refused.
        assertThat(ResponseAssembler.permitted(new ChatAction("PAYMENTS", "x", "x", "Sea Breeze", null), Set.of(Roles.CUSTOMER)))
                .isFalse();
        assertThat(ResponseAssembler.permitted(new ChatAction("PAYMENTS", "x", "x", null, null), Set.of(Roles.CUSTOMER)))
                .isTrue();
    }

    // ------------------------------------------------------------ validation

    @Test
    void aCardNamingAnUnknownReferenceIsDropped() {
        // The facts hold HT-7K3M9Q2X only; a card with another reference must not be shown.
        Facts facts = facts("{\"reference\":\"HT-7K3M9Q2X\",\"total\":\"₹18,900\"}");
        ChatBlock invented = ChatBlock.list("BOOKINGS", "Your trips", null, 1, null, List.of(new ChatBlock.Item(
                "Booking HT-AAAA2222", null, null, "neutral", List.of())));
        ChatBlock fine = ChatBlock.list("BOOKINGS", "Your trips", null, 1, null, List.of(new ChatBlock.Item(
                "Booking HT-7K3M9Q2X", null, null, "neutral", List.of(new ChatBlock.Field("Total", "₹18,900", "money")))));

        assertThat(ResponseAssembler.grounded(invented, facts)).isFalse();
        assertThat(ResponseAssembler.grounded(fine, facts)).isTrue();
    }

    @Test
    void assembledCardsMatchTheToolResultAndStayGrounded() {
        Facts facts = facts(TRIPS);
        ResponseAssembler.Result result = ResponseAssembler.assemble(Roles.CUSTOMER, Set.of(Roles.CUSTOMER),
                "Show my upcoming trips", List.of(run("my_bookings", TRIPS)), facts);

        assertThat(result.blocks()).hasSize(1);
        assertThat(result.blocks().getFirst().items()).hasSize(2);
        assertThat(result.actions()).extracting(ChatAction::route).containsExactly("MY_TRIPS");
    }

    // ------------------------------------------------------------- intent and gate

    @Test
    void liveDataQuestionsNeedAToolButHowToAndGeneralQuestionsDoNot() {
        assertThat(Intent.needsData(Roles.CUSTOMER, "Show my upcoming trips", false)).isTrue();
        assertThat(Intent.needsData(Roles.CUSTOMER, "What payments have I made?", false)).isTrue();
        assertThat(Intent.needsData(Roles.HOTEL_MANAGER, "Show today's arrivals", false)).isTrue();
        assertThat(Intent.needsData(Roles.ADMIN, "How many failed payments last week?", false)).isTrue();
        assertThat(Intent.needsData(Roles.CUSTOMER, "I want to update my profile", false)).isFalse();
        assertThat(Intent.needsData(Roles.CUSTOMER, "What is your refund policy?", false)).isFalse();
        assertThat(Intent.needsData(Roles.CUSTOMER, "Tell me a joke", false)).isFalse();
        // A follow-up of an answer that used a tool is a question about the same data.
        assertThat(Intent.needsData(Roles.CUSTOMER, "Show only the cancelled ones", true)).isTrue();
        assertThat(Intent.needsData(Roles.CUSTOMER, "Show only the cancelled ones", false)).isFalse();
    }

    @Test
    void anAnswerWithoutALookupIsReplacedAndOneWithALookupStreams() {
        int[] calls = {0};
        boolean[] violated = {false};
        List<String> without = ToolFirstGate.apply(Flux.just("You have ", "3 trips."), true, () -> calls[0],
                () -> violated[0] = true).collectList().block();
        assertThat(without).containsExactly(ToolFirstGate.NOT_LOOKED_UP);
        assertThat(violated[0]).isTrue();

        // The model says something, calls a tool, then answers: the preamble is dropped, the answer streams.
        calls[0] = 0;
        violated[0] = false;
        Flux<String> model = Flux.just("Let me check. ").concatWith(Flux.defer(() -> {
            calls[0] = 1;   // the tool is called after the preamble, before the answer
            return Flux.just("You have ", "no trips.");
        }));
        assertThat(ToolFirstGate.apply(model, true, () -> calls[0], () -> violated[0] = true).collectList().block())
                .containsExactly("You have ", "no trips.");
        assertThat(violated[0]).isFalse();

        // A question that needs no data is not touched.
        assertThat(ToolFirstGate.apply(Flux.just("Hello"), false, () -> 0, () -> violated[0] = true).collectList().block())
                .containsExactly("Hello");
    }
}
