package com.flighthotel.hotel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelReservation;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.HotelReservationRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.staff.HotelStaffStore;
import com.jayway.jsonpath.JsonPath;

/**
 * Phase 9 hotel figures (API_DOCUMENTATION.md §14.5): occupancy and revenue reports against a small known set of
 * stays (exact figures), their CSV exports, the manager dashboard, the admin overview across hotels, and the public
 * recommended hotels.
 */
class HotelReportIntegrationTest extends HotelIntegrationTest {

    @Autowired
    TransactionTemplate transactions;

    @Autowired
    HotelRepository hotels;

    @Autowired
    RoomTypeRepository roomTypes;

    @Autowired
    RatePlanRepository ratePlans;

    @Autowired
    HotelReservationRepository reservations;

    @Autowired
    HotelStaffStore staff;

    private TestStays stays;
    private Hotel hotel;
    private UUID managerId;
    private LocalDate today;

    @BeforeEach
    void testHotel() {
        stays = new TestStays(transactions, hotels, roomTypes, ratePlans, reservations, inventory, jdbcClient);
        hotel = stays.hotel("Report Test Hotel", "Reportville");
        today = inventory.today();
        managerId = UUID.randomUUID();
        staff.assign(hotel.getId(), managerId, "test", Instant.now());
    }

    /**
     * Five rooms on four nights (base … base+3), the last one stop-sold:
     * <pre>
     *   R1 checked out  base..+2  1 room   6000   → 3000 + 3000
     *   R2 confirmed    +1..+4    2 rooms  9000   → 3000 + 3000 + 3000
     *   R3 cancelled    base..+1  1 room   5000   → not counted
     *   R4 no-show      +2..+3    1 room   2500   → 2500 (a no-show keeps its revenue)
     *   R5 held         base..+1  1 room          → not counted
     *   R6 confirmed    base..+3  1 room   1000   → 333.33 + 333.33 + 333.34
     *
     *   night    available  booked  occupancy   revenue   sold  ADR
     *   base         5         2       40.0     3333.33     2   1666.67
     *   +1           5         4       80.0     6333.33     4   1583.33
     *   +2           5         4       80.0     5833.34     4   1458.34
     *   +3 (stop)    2         2      100.0     3000.00     2   1500.00
     *   total       17        12       70.6    18500.00    12   1541.67
     * </pre>
     */
    @Test
    void occupancyAndRevenueOfAKnownSetOfStays() throws Exception {
        LocalDate base = knownStays();
        String range = "range=CUSTOM&from=" + base + "&to=" + base.plusDays(3);
        String reports = "/api/hotel-manager/hotels/" + hotel.getId() + "/reports";

        mockMvc.perform(get(reports + "/occupancy?" + range).with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.range.preset").value("CUSTOM"))
                .andExpect(jsonPath("$.range.from").value(base.toString()))
                .andExpect(jsonPath("$.range.to").value(base.plusDays(3).toString()))
                .andExpect(jsonPath("$.hotelName").value(hotel.getName()))
                .andExpect(jsonPath("$.rows[*].date").value(contains(base.toString(), base.plusDays(1).toString(),
                        base.plusDays(2).toString(), base.plusDays(3).toString())))
                .andExpect(jsonPath("$.rows[*].roomNights").value(contains(5, 5, 5, 2)))
                .andExpect(jsonPath("$.rows[*].bookedRoomNights").value(contains(2, 4, 4, 2)))
                .andExpect(jsonPath("$.rows[*].occupancyPercent").value(contains(40.0, 80.0, 80.0, 100.0)))
                .andExpect(jsonPath("$.totals.roomNights").value(17))
                .andExpect(jsonPath("$.totals.bookedRoomNights").value(12))
                .andExpect(jsonPath("$.totals.occupancyPercent").value(70.6));

        mockMvc.perform(get(reports + "/revenue?" + range).with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currency").value("INR"))
                .andExpect(jsonPath("$.rows[*].roomNights").value(contains(2, 4, 4, 2)))
                .andExpect(jsonPath("$.rows[*].revenue").value(contains(3333.33, 6333.33, 5833.34, 3000.00)))
                .andExpect(jsonPath("$.rows[*].averageDailyRate").value(contains(1666.67, 1583.33, 1458.34, 1500.00)))
                .andExpect(jsonPath("$.totals.roomNights").value(12))
                .andExpect(jsonPath("$.totals.revenue").value(18500.00))
                .andExpect(jsonPath("$.totals.averageDailyRate").value(1541.67));

        // Phase 12: room type performance adds up to the revenue report (same rules), with each type's share.
        mockMvc.perform(get(reports + "/room-types?" + range).with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currency").value("INR"))
                .andExpect(jsonPath("$.roomNights").value(12))
                .andExpect(jsonPath("$.revenue").value(18500.00))
                .andExpect(jsonPath("$.rows[0].name").exists())
                .andExpect(jsonPath("$.rows[0].revenueShare").value(100.0))
                .andExpect(jsonPath("$.rows[0].averageDailyRate").value(1541.67));

        // Admins: the same figures side by side with every other hotel.
        mockMvc.perform(get("/api/admin/hotels/occupancy?" + range).with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.range.preset").value("CUSTOM"))
                .andExpect(jsonPath(hotelRow("name")).value(contains(hotel.getName())))
                .andExpect(jsonPath(hotelRow("city")).value(contains("Reportville")))
                .andExpect(jsonPath(hotelRow("roomNights")).value(contains(17)))
                .andExpect(jsonPath(hotelRow("bookedRoomNights")).value(contains(12)))
                .andExpect(jsonPath(hotelRow("occupancyPercent")).value(contains(70.6)))
                .andExpect(jsonPath(hotelRow("revenue")).value(contains(18500.00)));
        mockMvc.perform(get("/api/admin/hotels/occupancy?" + range).with(manager(managerId)))
                .andExpect(status().isForbidden());
    }

    @Test
    void reportsAreExportedAsCsvForExcel() throws Exception {
        LocalDate base = knownStays();
        String range = "range=CUSTOM&from=" + base + "&to=" + base.plusDays(3);
        String reports = "/api/hotel-manager/hotels/" + hotel.getId() + "/reports";

        MvcResult occupancy = mockMvc.perform(get(reports + "/occupancy/export?format=csv&" + range)
                        .with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "text/csv;charset=UTF-8"))
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"occupancy-"
                        + hotel.getSlug() + "-" + base + "-" + base.plusDays(3) + ".csv\""))
                .andReturn();
        assertThat(csvLines(occupancy)).containsExactly(
                "Date,Room nights,Booked room nights,Occupancy %",
                base + ",5,2,40.0",
                base.plusDays(1) + ",5,4,80.0",
                base.plusDays(2) + ",5,4,80.0",
                base.plusDays(3) + ",2,2,100.0",
                "Total,17,12,70.6");

        MvcResult revenue = mockMvc.perform(get(reports + "/revenue/export?" + range).with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"revenue-"
                        + hotel.getSlug() + "-" + base + "-" + base.plusDays(3) + ".csv\""))
                .andReturn();
        assertThat(csvLines(revenue)).containsExactly(
                "Date,Room nights sold,\"Revenue (INR, without GST)\",Average daily rate (INR)",
                base + ",2,3333.33,1666.67",
                base.plusDays(1) + ",4,6333.33,1583.33",
                base.plusDays(2) + ",4,5833.34,1458.34",
                base.plusDays(3) + ",2,3000.00,1500.00",
                "Total,12,18500.00,1541.67");

        MvcResult overview = mockMvc.perform(get("/api/admin/hotels/occupancy/export?format=csv&" + range)
                        .with(admin()))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"hotel-occupancy-"
                        + base + "-" + base.plusDays(3) + ".csv\""))
                .andReturn();
        assertThat(csvLines(overview)).first().isEqualTo(
                "Hotel,City,Room nights,Booked room nights,Occupancy %,\"Revenue (INR, without GST)\"");
        assertThat(csvLines(overview)).contains(hotel.getName() + ",Reportville,17,12,70.6,18500.00");

        mockMvc.perform(get(reports + "/occupancy/export?format=pdf&" + range).with(manager(managerId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_FORMAT"));
    }

    @Test
    void rangesFollowThePresetsAndRefuseNonsense() throws Exception {
        String occupancy = "/api/hotel-manager/hotels/" + hotel.getId() + "/reports/occupancy";

        mockMvc.perform(get(occupancy).with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.range.preset").value("LAST_30_DAYS"))
                .andExpect(jsonPath("$.range.from").value(today.minusDays(29).toString()))
                .andExpect(jsonPath("$.range.to").value(today.toString()))
                .andExpect(jsonPath("$.rows.length()").value(30))
                .andExpect(jsonPath("$.totals.occupancyPercent").value(0.0));
        mockMvc.perform(get(occupancy + "?range=THIS_MONTH").with(manager(managerId)))
                .andExpect(jsonPath("$.range.from").value(today.withDayOfMonth(1).toString()));
        for (String bad : List.of("range=CUSTOM&from=" + today, "range=YESTERDAY",
                "range=CUSTOM&from=" + today + "&to=" + today.minusDays(1),
                "range=CUSTOM&from=" + today.minusDays(366) + "&to=" + today)) {
            mockMvc.perform(get(occupancy + "?" + bad).with(manager(managerId)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        }
        mockMvc.perform(get(occupancy + "?range=CUSTOM&from=" + today.minusDays(365) + "&to=" + today)
                        .with(manager(managerId)))
                .andExpect(status().isOk());
    }

    /**
     * Four rooms, today at the front desk, the next week's arrivals and the last 7 days' figures:
     * <pre>
     *   A confirmed    today..+2      1 room  4000  arrival today, upcoming
     *   B checked in   -1..today      1 room  3500  departure today, in house
     *   C checked in   -2..+2         1 room  8000  in house (2000 a night)
     *   D confirmed    +3..+4         2 rooms 6000  upcoming
     *   E confirmed    +9..+10        1 room        beyond the next 7 days
     *   F cancelled    +1..+2                       a cancellation
     *   G held         +2..+3                       not paid: counts nowhere
     *   H checked out  -5..-3         1 room  2000  (1000 a night)
     *
     *   last 7 days (−6 … today): revenue 3500 + 3 × 2000 + 2000 + 2 × 1000 = 13500 over 7 room-nights (ADR 1928.57);
     *   booked 7 of 28 room-nights = 25.0 %; tonight 2 of 4 = 50.0 %
     * </pre>
     */
    @Test
    void theDashboardShowsTodayTheWeekAheadAndTheRange() throws Exception {
        TestStays.Room room = stays.room(hotel.getId(), 4, "3000.00", today.minusDays(7), today.plusDays(15));
        HotelReservation a = stays.stay(room, UUID.randomUUID(), today, today.plusDays(2), 1, "4000.00",
                ReservationStatus.CONFIRMED, "Asha", "Rao");
        stays.stay(room, UUID.randomUUID(), today.minusDays(1), today, 1, "3500.00", ReservationStatus.CHECKED_IN,
                "Bala", "Rao");
        stays.stay(room, UUID.randomUUID(), today.minusDays(2), today.plusDays(2), 1, "8000.00",
                ReservationStatus.CHECKED_IN, "Chitra", "Rao");
        HotelReservation d = stays.stay(room, UUID.randomUUID(), today.plusDays(3), today.plusDays(4), 2, "6000.00",
                ReservationStatus.CONFIRMED, "Dev", "Rao");
        stays.stay(room, UUID.randomUUID(), today.plusDays(9), today.plusDays(10), ReservationStatus.CONFIRMED);
        stays.stay(room, UUID.randomUUID(), today.plusDays(1), today.plusDays(2), ReservationStatus.CANCELLED);
        stays.stay(room, UUID.randomUUID(), today.plusDays(2), today.plusDays(3), ReservationStatus.HELD);
        stays.stay(room, UUID.randomUUID(), today.minusDays(5), today.minusDays(3), 1, "2000.00",
                ReservationStatus.CHECKED_OUT, "Hari", "Rao");

        mockMvc.perform(get("/api/hotel-manager/hotels/" + hotel.getId() + "/dashboard?range=LAST_7_DAYS")
                        .with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.range.preset").value("LAST_7_DAYS"))
                .andExpect(jsonPath("$.range.from").value(today.minusDays(6).toString()))
                .andExpect(jsonPath("$.range.to").value(today.toString()))
                .andExpect(jsonPath("$.today.date").value(today.toString()))
                .andExpect(jsonPath("$.today.arrivals").value(1))
                .andExpect(jsonPath("$.today.departures").value(1))
                .andExpect(jsonPath("$.today.inHouse").value(2))
                .andExpect(jsonPath("$.today.occupancyPercent").value(50.0))
                // Phase 12: the rooms behind that 50 % (the hotel's one room type has 4 rooms; 2 are booked tonight).
                .andExpect(jsonPath("$.today.totalRooms").value(4))
                .andExpect(jsonPath("$.today.roomsForSale").value(4))
                .andExpect(jsonPath("$.today.roomsBooked").value(2))
                .andExpect(jsonPath("$.upcomingArrivals[*].reservationId").value(contains(a.getId().toString(),
                        d.getId().toString())))
                .andExpect(jsonPath("$.upcomingArrivals[0].leadGuest").value("Asha Rao"))
                .andExpect(jsonPath("$.stats.reservations").value(7))
                .andExpect(jsonPath("$.stats.cancellations").value(1))
                .andExpect(jsonPath("$.stats.roomNights").value(7))
                .andExpect(jsonPath("$.stats.revenue").value(13500.00))
                .andExpect(jsonPath("$.stats.averageDailyRate").value(1928.57))
                .andExpect(jsonPath("$.stats.occupancyPercent").value(25.0));
    }

    // ------------------------------------------------------------------ public home page

    @Test
    void recommendedHotelsAreThePublishedOnesWithTheBestRating() throws Exception {
        Hotel unpublished = stays.hotel("Closed Palace", "Reportville", HotelStatus.INACTIVE, new BigDecimal("5.0"),
                40);

        String body = mockMvc.perform(get("/api/hotels/recommended"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(6))
                .andReturn().getResponse().getContentAsString();
        List<Double> ratings = JsonPath.read(body, "$[*].guestRating");
        assertThat(ratings).isSortedAccordingTo((x, y) -> Double.compare(y, x));

        mockMvc.perform(get("/api/hotels/recommended?limit=24"))
                .andExpect(jsonPath("$[*].id", not(hasItem(unpublished.getId().toString()))))
                .andExpect(jsonPath("$[0].name").value("Lake Pichola Palace"))
                .andExpect(jsonPath("$[0].city").value("Udaipur"))
                .andExpect(jsonPath("$[0].starRating").value(5))
                .andExpect(jsonPath("$[0].guestRating").value(4.8))
                .andExpect(jsonPath("$[0].reviewCount").value(450))
                // Cheapest plan on sale: the Lake View Room's "Saver" rate, 16500 × 0.88.
                .andExpect(jsonPath("$[0].priceFrom").value(14520.00))
                .andExpect(jsonPath("$[0].imageUrl").value(org.hamcrest.Matchers.matchesPattern(
                        "/api/hotels/images/[0-9a-f-]{36}\\?size=thumb")))
                .andExpect(jsonPath("$[0].demo").value(true))
                .andExpect(jsonPath("$[0].slug").exists());
    }

    // ------------------------------------------------------------------ helpers

    /** The stays of {@link #occupancyAndRevenueOfAKnownSetOfStays()}; returns the first night. */
    private LocalDate knownStays() {
        LocalDate base = today.minusDays(20);
        TestStays.Room room = stays.room(hotel.getId(), 5, "3000.00", base, base.plusDays(6));
        inventory.updateNights(room.roomTypeId(), base.plusDays(3), base.plusDays(3), null, true);
        stays.stay(room, UUID.randomUUID(), base, base.plusDays(2), 1, "6000.00", ReservationStatus.CHECKED_OUT,
                "R", "One");
        stays.stay(room, UUID.randomUUID(), base.plusDays(1), base.plusDays(4), 2, "9000.00",
                ReservationStatus.CONFIRMED, "R", "Two");
        stays.stay(room, UUID.randomUUID(), base, base.plusDays(1), 1, "5000.00", ReservationStatus.CANCELLED,
                "R", "Three");
        stays.stay(room, UUID.randomUUID(), base.plusDays(2), base.plusDays(3), 1, "2500.00",
                ReservationStatus.NO_SHOW, "R", "Four");
        stays.stay(room, UUID.randomUUID(), base, base.plusDays(1), 1, "3000.00", ReservationStatus.HELD,
                "R", "Five");
        stays.stay(room, UUID.randomUUID(), base, base.plusDays(3), 1, "1000.00", ReservationStatus.CONFIRMED,
                "R", "Six");
        return base;
    }

    private String hotelRow(String field) {
        return "$.hotels[?(@.hotelId == '" + hotel.getId() + "')]." + field;
    }

    /** The CSV as text lines: UTF-8 with a byte order mark, CRLF line ends. */
    private static List<String> csvLines(MvcResult result) {
        byte[] bytes = result.getResponse().getContentAsByteArray();
        assertThat(Arrays.copyOf(bytes, 3)).containsExactly(0xEF, 0xBB, 0xBF);
        String text = new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8);
        assertThat(text).endsWith("\r\n");
        return List.of(text.split("\r\n"));
    }
}
