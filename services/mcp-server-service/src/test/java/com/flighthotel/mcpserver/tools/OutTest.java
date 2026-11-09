package com.flighthotel.mcpserver.tools;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.mcpserver.security.Caller;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** The compact, LLM-friendly results: Indian amounts, masked passports, no staff-only fields for customers. */
class OutTest {

    private final JsonMapper json = JsonMapper.builder().build();

    @Test
    void amountsAreWrittenLikeTheApp() {
        assertThat(Out.money(new BigDecimal("6300.00"), "INR")).isEqualTo("₹6,300");
        assertThat(Out.money(new BigDecimal("200000.5"), "INR")).isEqualTo("₹2,00,000.50");
        assertThat(Out.money(new BigDecimal("999"), "INR")).isEqualTo("₹999");
        assertThat(Out.money(new BigDecimal("-1500"), "INR")).isEqualTo("-₹1,500");
        assertThat(Out.money(new BigDecimal("1234.5"), "USD")).isEqualTo("1,234.50 USD");
    }

    @Test
    void passportNumbersShowOnlyTheLastFour() {
        assertThat(Out.maskPassport("1234")).isEqualTo("****1234");
        assertThat(Out.maskPassport("N1234567")).isEqualTo("****4567");
        assertThat(Out.maskPassport(null)).isNull();
    }

    @Test
    void bookingDetailsAreCompactAndSafe() {
        JsonNode booking = json.readTree("""
                {"id":"0190aaaa-0000-7000-8000-000000000001","reference":"FL-4KD8M2PQ","type":"FLIGHT",
                 "status":"CONFIRMED","paymentStatus":"PAID","title":"Delhi to Mumbai","currency":"INR",
                 "totalAmount":8450.00,"baseAmount":8000,"taxAmount":450,"feeAmount":0,"discountAmount":0,
                 "refundedAmount":0,"contactEmail":"asha@example.com","contactPhone":"+91 98000 00000",
                 "supportNotes":[{"note":"internal"}],"attention":{"reason":"REFUND_FAILED","note":"internal"},
                 "flight":{"pnr":"K7QX2M","cabin":"ECONOMY","slices":[{"originCity":"New Delhi","origin":"DEL",
                   "destinationCity":"Mumbai","destination":"BOM","segments":[{"flightNumber":"AI 504",
                   "airlineName":"Air India"}]}],
                   "passengers":[{"firstName":"Asha","lastName":"Rao","passengerType":"ADULT",
                     "passportLast4":"4567","ticketNumber":"0981234567890"}]}}
                """);
        Caller customer = new Caller(new AuthenticatedUser(UUID.randomUUID(), "c@example.com", Set.of("CUSTOMER"),
                Set.of(), Instant.now()), "t");

        Map<String, Object> details = CustomerTools.details(booking, customer);
        String text = json.writeValueAsString(details);

        assertThat(details).containsEntry("reference", "FL-4KD8M2PQ").doesNotContainKey("id");
        assertThat(text).contains("\"total\":\"₹8,450\"").contains("K7QX2M").contains("****4567")
                .contains("AI 504 (Air India)").doesNotContain("passportLast4").doesNotContain("asha@example.com")
                .doesNotContain("internal").doesNotContain("+91").doesNotContain("discount");
        @SuppressWarnings("unchecked")
        Map<String, Object> flight = (Map<String, Object>) details.get("flight");
        assertThat((List<?>) flight.get("passengers")).hasSize(1);
    }

    @Test
    void staffSeeTheContactAndTheAttentionFlag() {
        JsonNode booking = json.readTree("""
                {"reference":"HT-7K3M9Q2X","contactEmail":"asha@example.com",
                 "attention":{"reason":"REFUND_FAILED","note":"internal note","since":"2026-11-05T10:00:00Z"}}
                """);
        Caller agent = new Caller(new AuthenticatedUser(UUID.randomUUID(), "s@example.com", Set.of("SUPPORT_AGENT"),
                Set.of("BOOKING_READ_ANY"), Instant.now()), "t");

        String text = json.writeValueAsString(CustomerTools.details(booking, agent));

        assertThat(text).contains("asha@example.com").contains("REFUND_FAILED").doesNotContain("internal note");
    }

    @Test
    void theAdminDashboardV2IsSummarisedWithItsComparison() {
        JsonNode dashboard = json.readTree("""
                {"range":{"preset":"THIS_MONTH","from":"2026-11-01","to":"2026-11-06"},
                 "customers":{"total":144,"newInRange":12},
                 "bookings":{"flight":298,"hotel":322,"upcoming":597,"completed":1,"cancelled":22,"pending":0,"failed":46},
                 "payments":{"pendingCount":0,"pendingAmount":0.0,"successfulCount":621,"successfulAmount":5437760.46,
                   "failedCount":2,"failedAmount":31444.68,"successRate":99.7},
                 "revenue":{"gross":5437760.46,"refunds":255857.8,"net":5181902.66,"currency":"INR"},
                 "cancellations":{"count":22,"hotel":12,"flight":10,"rate":3.5,"refundAmount":255857.8},
                 "comparison":{"bookings":{"current":620,"previous":500,"change":120,"changePercent":24.0,"trend":"UP"}},
                 "popularDestinations":[{"city":"Goa","bookings":210,"revenue":1840000}],
                 "bookingTrend":[{"date":"2026-11-01","flight":1,"hotel":3}],
                 "recentActivity":[{"action":"BOOKING_CANCELLED"}]}
                """);

        String text = json.writeValueAsString(AdminTools.dashboard(dashboard));

        assertThat(text).contains("\"paidTotal\":620").contains("\"failedCount\":2")
                .contains("\"failedAmount\":\"₹31,444.68\"").contains("\"successfulAmount\":\"₹54,37,760.46\"")
                .contains("\"net\":\"₹51,81,902.66\"").contains("\"ratePercent\":3.5")
                .contains("\"changePercent\":24").contains("Goa")
                .doesNotContain("bookingTrend").doesNotContain("recentActivity");
    }

    @Test
    void theCustomerSummaryKeepsTheNextTrip() {
        JsonNode summary = json.readTree("""
                {"range":{"preset":"THIS_YEAR","from":"2026-01-01","to":"2026-11-06"},
                 "bookings":{"total":2,"hotel":1,"flight":1,"upcoming":2,"completed":0,"cancelled":0},
                 "trips":{"upcoming":2,"completed":0,"cancelled":0,"pending":0},
                 "spending":{"currency":"INR","paid":14750.0,"refunded":0,"net":14750.0,"refundsInProgress":0},
                 "monthlyActivity":[{"month":"2026-11"}],
                 "nextTrip":{"reference":"HT-7K3M9Q2X","type":"HOTEL","title":"Sea Breeze Resort","startDate":"2026-12-01",
                   "daysUntil":25,"totalAmount":6300,"currency":"INR","hotel":{"hotelName":"Sea Breeze Resort",
                   "confirmationNumber":"H7K3M9Q2XA"},"flight":null}}
                """);

        String text = json.writeValueAsString(CustomerTools.summary(summary));

        assertThat(text).contains("\"paid\":\"₹14,750\"").contains("HT-7K3M9Q2X").contains("H7K3M9Q2XA")
                .contains("\"daysUntil\":25").doesNotContain("monthlyActivity");
    }

    @Test
    void reportsKeepTotalsAndFormatMoneyColumns() {
        JsonNode page = json.readTree("""
                {"report":"payments","title":"Payments","range":{"preset":"LAST_7_DAYS","from":"2026-10-31","to":"2026-11-06"},
                 "columns":[{"key":"bookingReference","label":"Booking","type":"TEXT"},{"key":"amount","label":"Amount","type":"MONEY"}],
                 "content":[{"bookingReference":"HT-QWKH9J7S","amount":18025.68},{"bookingReference":"HT-SGUZXM27","amount":13419}],
                 "totals":{"count":2,"amount":31444.68},"totalElements":2}
                """);

        Map<String, Object> report = AdminTools.report(page, 1);

        assertThat(report).containsEntry("rowCount", 2L);
        assertThat(report.get("totals")).isEqualTo(Map.of("count", 2L, "amount", "₹31,444.68"));
        assertThat((List<?>) report.get("rows")).hasSize(1);
    }
}
