package com.flighthotel.mcpserver.tools;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/** Tool arguments are checked against the same definition the model sees as JSON schema. */
class ToolInputValidationTest {

    private final ToolDefinition tool = ToolDefinition.named("sample_tool")
            .title("Sample")
            .description("A sample")
            .roles("CUSTOMER")
            .param(BookingLookup.referenceParam())
            .param(Param.oneOf("tab", "Which", List.of("ALL", "UPCOMING", "PENDING")))
            .param(Param.integer("limit", "Rows", 1, 20))
            .param(Param.date("from", "First day"))
            .param(Param.bool("unreadOnly", "Only unread"))
            .param(Param.text("q", "Search", 2, 10))
            .handler((args, caller) -> Map.of());

    private static Map<String, Object> args(Object... keyValues) {
        Map<String, Object> map = new HashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            map.put((String) keyValues[i], keyValues[i + 1]);
        }
        return map;
    }

    @Test
    void validValuesAreNormalised() {
        Args args = tool.validate(args("reference", " ht-7k3m9q2x ", "tab", "upcoming", "limit", 5, "from",
                "2026-12-01", "unreadOnly", "true", "q", " Goa "));

        assertThat(args.text("reference")).isEqualTo("HT-7K3M9Q2X");
        assertThat(args.text("tab")).isEqualTo("UPCOMING");
        assertThat(args.integer("limit", 10)).isEqualTo(5);
        assertThat(args.date("from")).isEqualTo(LocalDate.of(2026, 12, 1));
        assertThat(args.bool("unreadOnly")).isTrue();
        assertThat(args.text("q")).isEqualTo("Goa");
    }

    @Test
    void optionalValuesMayBeMissingAndUnknownOnesAreIgnored() {
        Args args = tool.validate(args("reference", "FL-4KD8M2PQ", "somethingElse", "x"));

        assertThat(args.has("tab")).isFalse();
        assertThat(args.integer("limit", 10)).isEqualTo(10);
    }

    @Test
    void requiredValuesAreRequired() {
        assertThatThrownBy(() -> tool.validate(args())).isInstanceOf(ToolInputException.class)
                .hasMessage("reference is required");
        assertThatThrownBy(() -> tool.validate(args("reference", "  "))).hasMessage("reference is required");
    }

    @Test
    void formatsSizesAndEnumsAreEnforced() {
        assertThatThrownBy(() -> tool.validate(args("reference", "HT-123"))).hasMessageContaining("must look like");
        assertThatThrownBy(() -> tool.validate(args("reference", "HT-7K3M9Q2X; DROP TABLE")))
                .hasMessageContaining("must look like");
        assertThatThrownBy(() -> tool.validate(args("reference", "HT-7K3M9Q2X", "tab", "EVERYTHING")))
                .hasMessage("tab must be one of ALL, UPCOMING, PENDING");
        assertThatThrownBy(() -> tool.validate(args("reference", "HT-7K3M9Q2X", "limit", 500)))
                .hasMessage("limit must be between 1 and 20");
        assertThatThrownBy(() -> tool.validate(args("reference", "HT-7K3M9Q2X", "limit", 2.5)))
                .hasMessage("limit must be a whole number");
        assertThatThrownBy(() -> tool.validate(args("reference", "HT-7K3M9Q2X", "from", "next friday")))
                .hasMessage("from must be a date like 2026-12-31");
        assertThatThrownBy(() -> tool.validate(args("reference", "HT-7K3M9Q2X", "unreadOnly", "maybe")))
                .hasMessage("unreadOnly must be true or false");
        assertThatThrownBy(() -> tool.validate(args("reference", "HT-7K3M9Q2X", "q", "a")))
                .hasMessage("q must be 2 to 10 characters");
        assertThatThrownBy(() -> tool.validate(args("reference", "HT-7K3M9Q2X", "q", "this is far too long")))
                .hasMessage("q must be 2 to 10 characters");
        assertThatThrownBy(() -> tool.validate(args("reference", "HT-7K3M9Q2X", "q", "ab\u0000cd")))
                .hasMessage("q contains control characters");
        assertThatThrownBy(() -> tool.validate(args("reference", 12345))).hasMessage("reference must be text");
    }

    @Test
    void theSchemaDescribesTheSameRules() {
        Map<String, Object> schema = tool.inputSchema();

        assertThat(schema).containsEntry("type", "object").containsEntry("required", List.of("reference"))
                .containsEntry("additionalProperties", false);
        @SuppressWarnings("unchecked")
        Map<String, Map<String, Object>> properties = (Map<String, Map<String, Object>>) schema.get("properties");
        assertThat(properties.get("tab")).containsEntry("enum", List.of("ALL", "UPCOMING", "PENDING"));
        assertThat(properties.get("limit")).containsEntry("minimum", 1L).containsEntry("maximum", 20L);
        assertThat(properties.get("from")).containsEntry("format", "date");
        assertThat(properties.get("q")).containsEntry("maxLength", 10);
    }

    @Test
    void toolNamesMustBeSnakeCase() {
        assertThatThrownBy(() -> ToolDefinition.named("MyTool").roles("CUSTOMER").handler((a, c) -> null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void customRangesAreChecked() {
        ToolDefinition ranged = ToolDefinition.named("ranged").roles("ADMIN").param(Ranges.range())
                .param(Ranges.from("f")).param(Ranges.to("t")).handler((a, c) -> null);

        assertThat(Ranges.query(ranged.validate(args("range", "this_month")))).containsEntry("range", "THIS_MONTH");
        assertThat(Ranges.query(ranged.validate(args("from", "2026-10-01", "to", "2026-10-31"))))
                .containsEntry("range", "CUSTOM").containsEntry("from", LocalDate.of(2026, 10, 1));
        assertThatThrownBy(() -> Ranges.query(ranged.validate(args("range", "CUSTOM", "from", "2026-10-01"))))
                .hasMessage("to is required for a CUSTOM range");
        assertThatThrownBy(() -> Ranges.query(ranged.validate(args("from", "2026-10-31", "to", "2026-10-01"))))
                .hasMessage("to must not be before from");
        assertThatThrownBy(() -> Ranges.query(ranged.validate(args("from", "2025-01-01", "to", "2026-10-01"))))
                .hasMessage("to must be at most 366 days after from");
    }
}
