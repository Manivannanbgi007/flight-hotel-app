package com.flighthotel.hotel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
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
import com.flighthotel.hotel.support.Uuids;
import com.jayway.jsonpath.JsonPath;

/**
 * Phase 11 hotel manager figures (the dashboard of API_DOCUMENTATION.md §14.5, extended): RevPAR, the people at the
 * front desk, cancellations by who cancelled, the rating over time, the trend by interval and the comparison with the
 * previous period. Every figure is checked against the stays and reviews it comes from, and against the Phase 9
 * occupancy and revenue reports of the same nights.
 */
class HotelAnalyticsIntegrationTest extends HotelIntegrationTest {

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

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

    /** A stay as the test made it: when it was booked and cancelled (India days), and by whom. */
    record Stay(ReservationStatus status, LocalDate bookedOn, LocalDate cancelledOn, boolean byHotel) {
    }

    record Approved(LocalDate day, int rating) {
    }

    private final List<Stay> source = new ArrayList<>();
    private final List<Approved> approved = new ArrayList<>();
    private TestStays stays;
    private Hotel hotel;
    private TestStays.Room room;
    private UUID managerId;
    private LocalDate today;
    private String dashboard;

    @BeforeEach
    void aHotelWithFourMonthsOfStaysAndReviews() throws Exception {
        stays = new TestStays(transactions, hotels, roomTypes, ratePlans, reservations, inventory, jdbcClient);
        // Started with "4.0 from 2 reviews", like a demo hotel.
        hotel = stays.hotel("Analytics Hotel", "Trendville", HotelStatus.ACTIVE, new BigDecimal("4.0"), 2);
        today = inventory.today();
        managerId = UUID.randomUUID();
        staff.assign(hotel.getId(), managerId, "test", Instant.now());
        room = stays.room(hotel.getId(), 10, "3000.00", today.minusDays(120), today.plusDays(10));
        dashboard = "/api/hotel-manager/hotels/" + hotel.getId() + "/dashboard";

        HotelReservation s1 = stay(-60, -57, 1, "9000.00", ReservationStatus.CHECKED_OUT, -65, null, false);
        HotelReservation s2 = stay(-50, -45, 2, "20000.00", ReservationStatus.CHECKED_OUT, -52, null, false);
        stay(-30, -28, 1, "6000.00", ReservationStatus.CONFIRMED, -40, null, false);
        stay(-20, -19, 1, "2500.00", ReservationStatus.NO_SHOW, -25, null, false);
        stay(2, 4, 1, "6000.00", ReservationStatus.CANCELLED, -10, -5, false);
        stay(-3, -1, 1, "6000.00", ReservationStatus.CANCELLED, -15, -4, true);
        stay(-1, 2, 1, "7500.00", ReservationStatus.CHECKED_IN, -8, null, false);
        stay(0, 1, 2, "5000.00", ReservationStatus.CONFIRMED, -3, null, false);
        stay(-70, -69, 1, "3000.00", ReservationStatus.CANCELLED, -58, -54, false);
        stay(5, 6, 1, "3000.00", ReservationStatus.HELD, -2, null, false);
        HotelReservation r1 = stay(-90, -88, 1, "6000.00", ReservationStatus.CHECKED_OUT, -95, null, false);
        HotelReservation r2 = stay(-85, -84, 1, "3000.00", ReservationStatus.CHECKED_OUT, -95, null, false);
        HotelReservation r3 = stay(-80, -79, 1, "3000.00", ReservationStatus.CHECKED_OUT, -95, null, false);

        // Reviews: approved before the range, twice in it; one waiting, one rejected.
        review(s1, 5, "APPROVE", -58);
        review(s2, 5, "APPROVE", -44);
        review(r1, 4, "APPROVE", -20);
        review(r2, 2, null, 0);
        review(r3, 1, "REJECT", -10);
    }

    @Test
    void theRangesFiguresMatchTheStaysTheReportsAndEachOther() throws Exception {
        LocalDate from = today.minusDays(55);
        String range = "range=CUSTOM&from=" + from + "&to=" + today;
        String body = mockMvc.perform(get(dashboard + "?" + range + "&interval=WEEK").with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interval").value("WEEK"))
                .andExpect(jsonPath("$.previousRange.preset").value("PREVIOUS_PERIOD"))
                .andExpect(jsonPath("$.previousRange.from").value(today.minusDays(111).toString()))
                .andExpect(jsonPath("$.previousRange.to").value(today.minusDays(56).toString()))
                .andReturn().getResponse().getContentAsString();

        // Occupancy, revenue, ADR: the same as the Phase 9 reports of these nights; RevPAR from them.
        String occupancy = report("occupancy", range);
        String revenue = report("revenue", range);
        assertThat(count(body, "$.stats.availableRoomNights")).isEqualTo(count(occupancy, "$.totals.roomNights"));
        assertThat(count(body, "$.stats.bookedRoomNights")).isEqualTo(count(occupancy, "$.totals.bookedRoomNights"));
        assertThat(money(body, "$.stats.occupancyPercent")).isEqualByComparingTo(money(occupancy, "$.totals.occupancyPercent"));
        assertThat(money(body, "$.stats.revenue")).isEqualByComparingTo(money(revenue, "$.totals.revenue"))
                .isEqualByComparingTo("38500.00");   // S2 20000 + S3 6000 + S4 2500 + 2 of S7's 3 nights + S8
        assertThat(count(body, "$.stats.roomNights")).isEqualTo(count(revenue, "$.totals.roomNights"));
        assertThat(money(body, "$.stats.averageDailyRate")).isEqualByComparingTo(money(revenue, "$.totals.averageDailyRate"));
        assertThat(money(body, "$.stats.revPar")).isEqualByComparingTo(money(revenue, "$.totals.revenue")
                .divide(BigDecimal.valueOf(count(occupancy, "$.totals.roomNights")), 2, RoundingMode.HALF_UP));

        // Bookings and cancellations of the range's days, against the stays.
        long booked = source.stream().filter(s -> paid(s) && inRange(s.bookedOn(), from, today)).count();
        long cancelledOfBooked = source.stream().filter(s -> paid(s) && inRange(s.bookedOn(), from, today)
                && s.status() == ReservationStatus.CANCELLED).count();
        long cancelled = source.stream().filter(s -> inRange(s.cancelledOn(), from, today)).count();
        long byHotel = source.stream().filter(s -> inRange(s.cancelledOn(), from, today) && s.byHotel()).count();
        assertThat(booked).isEqualTo(7);
        assertThat(cancelled).isEqualTo(3);
        assertThat(count(body, "$.stats.reservations")).isEqualTo(booked);
        assertThat(count(body, "$.stats.cancellations")).isEqualTo(cancelled);
        assertThat(count(body, "$.cancellations.count")).isEqualTo(cancelled);
        assertThat(count(body, "$.cancellations.byHotel")).isEqualTo(byHotel).isEqualTo(1);
        assertThat(count(body, "$.cancellations.byCustomer")).isEqualTo(cancelled - byHotel);
        assertThat(count(body, "$.cancellations.ofBooked")).isEqualTo(cancelledOfBooked).isEqualTo(2);
        assertThat(money(body, "$.cancellations.rate")).isEqualByComparingTo(percent(cancelledOfBooked, booked));

        // Reviews: the rating now (as moderation stored it) and those approved in the range.
        BigDecimal ratingNow = jdbcClient.sql("SELECT avg_rating FROM hotels WHERE id = :id")
                .param("id", Uuids.param(hotel.getId())).query(BigDecimal.class).single();
        assertThat(ratingNow).isEqualByComparingTo("4.4");   // (4.0 × 2 + 5 + 5 + 4) / 5
        assertThat(money(body, "$.ratings.guestRating")).isEqualByComparingTo(ratingNow);
        assertThat(count(body, "$.ratings.reviewCount")).isEqualTo(5);
        assertThat(count(body, "$.ratings.newReviews")).isEqualTo(2);
        assertThat(money(body, "$.ratings.averageNewRating")).isEqualByComparingTo("4.5");
        assertThat(count(body, "$.ratings.pendingReviews")).isEqualTo(1);

        // The weekly trend: each week equals the report rows of its nights and the stays of its days.
        List<String> starts = JsonPath.read(body, "$.trend[*].start");
        List<String> ends = JsonPath.read(body, "$.trend[*].end");
        assertThat(starts.getFirst()).isEqualTo(from.toString());
        assertThat(ends.getLast()).isEqualTo(today.toString());
        for (int i = 0; i < starts.size(); i++) {
            LocalDate start = LocalDate.parse(starts.get(i));
            LocalDate end = LocalDate.parse(ends.get(i));
            String point = "$.trend[" + i + "]";
            String nights = "[?(@.date >= '" + start + "' && @.date <= '" + end + "')]";
            assertThat(count(body, point + ".availableRoomNights")).as(point)
                    .isEqualTo(sumOf(occupancy, "$.rows" + nights + ".roomNights").longValue());
            assertThat(count(body, point + ".bookedRoomNights")).as(point)
                    .isEqualTo(sumOf(occupancy, "$.rows" + nights + ".bookedRoomNights").longValue());
            assertThat(money(body, point + ".revenue")).as(point)
                    .isEqualByComparingTo(sumOf(revenue, "$.rows" + nights + ".revenue"));
            assertThat(count(body, point + ".soldRoomNights")).as(point)
                    .isEqualTo(sumOf(revenue, "$.rows" + nights + ".roomNights").longValue());
            assertThat(count(body, point + ".reservations")).as(point).isEqualTo(source.stream()
                    .filter(s -> paid(s) && inRange(s.bookedOn(), start, end)).count());
            assertThat(count(body, point + ".cancellations")).as(point).isEqualTo(source.stream()
                    .filter(s -> inRange(s.cancelledOn(), start, end)).count());
            assertThat(count(body, point + ".newReviews")).as(point).isEqualTo(approved.stream()
                    .filter(a -> inRange(a.day(), start, end)).count());
            // The rating at the end of the week: the seed figures and every review approved until then.
            List<Approved> until = approved.stream().filter(a -> !a.day().isAfter(end)).toList();
            BigDecimal rating = BigDecimal.valueOf(8 + until.stream().mapToInt(Approved::rating).sum())
                    .divide(BigDecimal.valueOf(2 + until.size()), 1, RoundingMode.HALF_UP);
            assertThat(money(body, point + ".guestRating")).as(point).isEqualByComparingTo(rating);
            assertThat(count(body, point + ".reviewCount")).as(point).isEqualTo(2 + until.size());
        }
        assertThat(money(body, "$.trend[0].guestRating")).isEqualByComparingTo("4.3");   // (8 + 5) / 3
        assertThat(money(body, "$.trend[-1].guestRating")).isEqualByComparingTo(ratingNow);
        assertThat(sumOf(body, "$.trend[*].revenue")).isEqualByComparingTo(money(body, "$.stats.revenue"));
        assertThat(sumOf(body, "$.trend[*].reservations").longValue()).isEqualTo(booked);
        assertThat(sumOf(body, "$.trend[*].availableRoomNights").longValue())
                .isEqualTo(count(body, "$.stats.availableRoomNights"));

        // Against the previous 56 days, from the reports of those nights and the stays of those days.
        LocalDate previousFrom = today.minusDays(111);
        LocalDate previousTo = today.minusDays(56);
        String previousRange = "range=CUSTOM&from=" + previousFrom + "&to=" + previousTo;
        String previousRevenue = report("revenue", previousRange);
        String previousOccupancy = report("occupancy", previousRange);
        assertThat(money(body, "$.comparison.revenue.current")).isEqualByComparingTo(money(body, "$.stats.revenue"));
        assertThat(money(body, "$.comparison.revenue.previous"))
                .isEqualByComparingTo(money(previousRevenue, "$.totals.revenue")).isPositive();
        assertThat(money(body, "$.comparison.occupancyPercent.previous"))
                .isEqualByComparingTo(money(previousOccupancy, "$.totals.occupancyPercent"));
        assertThat(money(body, "$.comparison.averageDailyRate.previous"))
                .isEqualByComparingTo(money(previousRevenue, "$.totals.averageDailyRate"));
        assertThat(count(body, "$.comparison.reservations.previous")).isEqualTo(source.stream()
                .filter(s -> paid(s) && inRange(s.bookedOn(), previousFrom, previousTo)).count());
        assertThat(count(body, "$.comparison.cancellations.previous")).isZero();
        assertThat(count(body, "$.comparison.newReviews.previous")).isEqualTo(1);
        assertThat((String) JsonPath.read(body, "$.comparison.cancellations.trend")).isEqualTo("UP");
        assertThat(JsonPath.<Object>read(body, "$.comparison.cancellations.changePercent")).isNull();
    }

    @Test
    void todayAtTheFrontDeskCountsPeopleAndRooms() throws Exception {
        mockMvc.perform(get(dashboard + "?range=LAST_7_DAYS").with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interval").value("DAY"))
                .andExpect(jsonPath("$.trend.length()").value(7))
                .andExpect(jsonPath("$.today.arrivals").value(1))
                .andExpect(jsonPath("$.today.arrivingGuests").value(4))   // two rooms, two adults each
                .andExpect(jsonPath("$.today.departures").value(0))
                .andExpect(jsonPath("$.today.departingGuests").value(0))
                .andExpect(jsonPath("$.today.inHouse").value(1))
                .andExpect(jsonPath("$.today.inHouseGuests").value(2))
                .andExpect(jsonPath("$.today.inHouseRooms").value(1));
    }

    @Test
    void intervalsYearlyRangesAndTheRules() throws Exception {
        String month = mockMvc.perform(get(dashboard + "?range=LAST_90_DAYS&interval=MONTH").with(manager(managerId)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(sumOf(month, "$.trend[*].revenue")).isEqualByComparingTo(money(month, "$.stats.revenue"));
        assertThat(sumOf(month, "$.trend[*].bookedRoomNights").longValue())
                .isEqualTo(count(month, "$.stats.bookedRoomNights"));
        String daily = mockMvc.perform(get(dashboard + "?range=LAST_90_DAYS&interval=DAY").with(manager(managerId)))
                .andExpect(jsonPath("$.trend.length()").value(90))
                .andReturn().getResponse().getContentAsString();
        assertThat(money(daily, "$.stats.revenue")).isEqualByComparingTo(money(month, "$.stats.revenue"));

        mockMvc.perform(get(dashboard + "?range=LAST_5_YEARS").with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.interval").value("YEAR"))
                .andExpect(jsonPath("$.trend.length()").value(5))
                .andExpect(jsonPath("$.trend[-1].guestRating").value(4.4));
        mockMvc.perform(get(dashboard + "?range=THIS_YEAR").with(manager(managerId)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.interval").value("MONTH"));
        mockMvc.perform(get(dashboard + "?range=LAST_5_YEARS&interval=DAY").with(manager(managerId)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_INTERVAL"));
        mockMvc.perform(get(dashboard + "?range=CUSTOM&from=2019-01-01&to=" + today).with(manager(managerId)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_RANGE"));
        // The reports keep their 366 days.
        mockMvc.perform(get("/api/hotel-manager/hotels/" + hotel.getId() + "/reports/revenue?range=LAST_3_YEARS")
                        .with(manager(managerId)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_RANGE"));

        // Another hotel's manager: HOTEL_NOT_ASSIGNED before anything else is looked at.
        mockMvc.perform(get(dashboard + "?range=THIS_YEAR&interval=HOUR").with(manager(UUID.randomUUID())))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("HOTEL_NOT_ASSIGNED"));
        mockMvc.perform(get(dashboard + "?range=THIS_YEAR").with(admin()))
                .andExpect(status().isOk());
    }

    // ------------------------------------------------------------------ the source data

    /** A stay over [checkIn, checkOut) (days from today), booked and maybe cancelled on those days (India). */
    private HotelReservation stay(int checkIn, int checkOut, int rooms, String subtotal, ReservationStatus status,
            int bookedOn, Integer cancelledOn, boolean byHotel) {
        HotelReservation reservation = stays.stay(room, UUID.randomUUID(), today.plusDays(checkIn),
                today.plusDays(checkOut), rooms, subtotal, status, "Guest", "No" + source.size());
        LocalDate booked = today.plusDays(bookedOn);
        LocalDate cancelled = cancelledOn == null ? null : today.plusDays(cancelledOn);
        jdbcClient.sql("UPDATE hotel_reservations SET created_at = :created, cancelled_at = COALESCE(:cancelled, "
                        + "cancelled_at), cancelled_by = IF(:hotel, 'HOTEL', cancelled_by) WHERE id = :id")
                .param("created", noon(booked))
                .param("cancelled", cancelled == null ? null : noon(cancelled))
                .param("hotel", byHotel)
                .param("id", Uuids.param(reservation.getId()))
                .update();
        source.add(new Stay(status, booked, cancelled, byHotel));
        return reservation;
    }

    /** The guest writes a review; a moderator approves or rejects it, on that day (days from today). */
    private void review(HotelReservation stay, int rating, String decision, int decidedOn) throws Exception {
        String body = mockMvc.perform(post("/api/reviews").with(customer(stay.getUserId()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"bookingId":"%s","rating":%d,"title":"Our stay","text":"%s"}"""
                                .formatted(stay.getBookingId(), rating,
                                        "A quiet room, friendly staff and a good breakfast every morning.")))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(body, "$.id");
        if (decision == null) {
            return;
        }
        if (decision.equals("APPROVE")) {
            mockMvc.perform(post("/api/admin/reviews/" + id + "/approve").with(moderator())).andExpect(status().isOk());
            approved.add(new Approved(today.plusDays(decidedOn), rating));
        } else {
            mockMvc.perform(post("/api/admin/reviews/" + id + "/reject").with(moderator())
                            .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Not about the stay\"}"))
                    .andExpect(status().isOk());
        }
        jdbcClient.sql("UPDATE reviews SET moderated_at = :at WHERE id = UUID_TO_BIN(:id)")
                .param("at", noon(today.plusDays(decidedOn))).param("id", id).update();
    }

    private static boolean paid(Stay stay) {
        return stay.status() != ReservationStatus.HELD;
    }

    private static boolean inRange(LocalDate day, LocalDate from, LocalDate to) {
        return day != null && !day.isBefore(from) && !day.isAfter(to);
    }

    // ------------------------------------------------------------------ helpers

    private String report(String name, String range) throws Exception {
        return mockMvc.perform(get("/api/hotel-manager/hotels/" + hotel.getId() + "/reports/" + name + "?" + range)
                        .with(manager(managerId)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /** 12:00 in India on that day, as the UTC wall time of a DATETIME column. */
    private static LocalDateTime noon(LocalDate day) {
        return LocalDateTime.ofInstant(day.atTime(LocalTime.NOON).atZone(INDIA).toInstant(), ZoneOffset.UTC);
    }

    private static BigDecimal percent(long part, long whole) {
        return BigDecimal.valueOf(part * 100).divide(BigDecimal.valueOf(whole), 1, RoundingMode.HALF_UP);
    }

    private static long count(String json, String path) {
        return ((Number) JsonPath.read(json, path)).longValue();
    }

    private static BigDecimal money(String json, String path) {
        return new BigDecimal(JsonPath.read(json, path).toString());
    }

    private static BigDecimal sumOf(String json, String path) {
        List<Object> values = JsonPath.read(json, path);
        return values.stream().map(value -> new BigDecimal(value.toString())).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static JwtRequestPostProcessor customer(UUID userId) {
        return user(userId, Set.of("CUSTOMER"), Set.of());
    }

    private static JwtRequestPostProcessor moderator() {
        return user(UUID.randomUUID(), Set.of("ADMIN"), Set.of("REVIEW_MODERATE", "HOTEL_MANAGE_ANY"));
    }
}
