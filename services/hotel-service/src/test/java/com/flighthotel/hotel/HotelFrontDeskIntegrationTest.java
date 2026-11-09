package com.flighthotel.hotel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.events.audit.AuditEventRecorded;
import com.flighthotel.events.hotel.GuestCheckedIn;
import com.flighthotel.events.hotel.GuestCheckedOut;
import com.flighthotel.events.hotel.HotelReservationCancelled;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelReservation;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.HotelReservationRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.staff.HotelStaffStore;

/**
 * Phase 9 hotel manager front desk (API_DOCUMENTATION.md §14.5): the access rule on every new endpoint, the
 * reservation list, and check-in / check-out / no-show / hotel cancellation with their date and state rules, the
 * inventory they give back and the events they publish.
 */
class HotelFrontDeskIntegrationTest extends HotelIntegrationTest {

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
    private TestStays.Room room;
    private UUID managerId;
    private LocalDate today;

    @BeforeEach
    void testHotel() {
        stays = new TestStays(transactions, hotels, roomTypes, ratePlans, reservations, inventory, jdbcClient);
        hotel = stays.hotel("Front Desk Hotel", "Deskville");
        today = inventory.today();
        room = stays.room(hotel.getId(), 4, "3000.00", today.minusDays(10), today.plusDays(40));
        managerId = UUID.randomUUID();
        staff.assign(hotel.getId(), managerId, "test", Instant.now());
    }

    // ------------------------------------------------------------------ access

    @Test
    void everyNewManagerEndpointRefusesAHotelThatIsNotAssigned() throws Exception {
        HotelReservation stay = stays.stay(room, UUID.randomUUID(), today, today.plusDays(1),
                ReservationStatus.CONFIRMED);
        UUID stranger = UUID.randomUUID();
        staff.assign(stays.hotel("Somebody Else's Hotel", "Deskville").getId(), stranger, "test", Instant.now());
        String base = "/api/hotel-manager/hotels/" + hotel.getId();
        String reservation = base + "/reservations/" + stay.getId();
        String range = "?range=LAST_7_DAYS";

        List<MockHttpServletRequestBuilder> requests = List.of(
                get(base + "/reservations"),
                get(base + "/reservations/summary"),
                get(base + "/reports/room-types" + range),
                get(base + "/reviews/summary"),
                get(reservation),
                post(reservation + "/check-in"),
                post(reservation + "/check-out"),
                post(reservation + "/no-show"),
                post(reservation + "/cancel").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Overbooked tonight\"}"),
                get(base + "/dashboard" + range),
                get(base + "/reports/occupancy" + range),
                get(base + "/reports/occupancy/export" + range + "&format=csv"),
                get(base + "/reports/revenue" + range),
                get(base + "/reports/revenue/export" + range + "&format=csv"),
                get(base + "/reviews"));
        for (MockHttpServletRequestBuilder request : requests) {
            mockMvc.perform(request.with(manager(stranger)))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("HOTEL_NOT_ASSIGNED"));
        }
        // Customers never; visitors must log in; admins reach every hotel.
        mockMvc.perform(get(base + "/reservations").with(customer())).andExpect(status().isForbidden());
        mockMvc.perform(get(base + "/reservations")).andExpect(status().isUnauthorized());
        mockMvc.perform(get(base + "/reservations").with(admin())).andExpect(status().isOk());
        // Nothing happened to the stay.
        assertThat(reservations.findById(stay.getId()).orElseThrow().getStatus()).isEqualTo(ReservationStatus.CONFIRMED);
    }

    // ------------------------------------------------------------------ list and details

    @Test
    void reservationListFiltersSearchesSortsAndPages() throws Exception {
        HotelReservation upcoming = stays.stay(room, UUID.randomUUID(), today.plusDays(2), today.plusDays(4), 2,
                "12000.00", ReservationStatus.CONFIRMED, "Meera", "Iyer");
        HotelReservation departed = stays.stay(room, UUID.randomUUID(), today.minusDays(6), today.minusDays(4), 1,
                "6000.00", ReservationStatus.CHECKED_OUT, "Arjun", "Nair");
        HotelReservation held = stays.stay(room, UUID.randomUUID(), today.plusDays(3), today.plusDays(4),
                ReservationStatus.HELD);
        HotelReservation cancelled = stays.stay(room, UUID.randomUUID(), today.plusDays(5), today.plusDays(6), 1,
                "3000.00", ReservationStatus.CANCELLED, "Kiran", "Das");
        stays.stay(room, UUID.randomUUID(), today.plusDays(6), today.plusDays(7), ReservationStatus.EXPIRED);
        HotelReservation noShow = stays.stay(room, UUID.randomUUID(), today.minusDays(3), today.minusDays(1), 1,
                "6000.00", ReservationStatus.NO_SHOW, "Sana", "Khan");
        String list = "/api/hotel-manager/hotels/" + hotel.getId() + "/reservations";

        // Held, expired and released reservations only when asked for.
        mockMvc.perform(get(list).with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(4))
                .andExpect(jsonPath("$.content[*].reservationId", containsInAnyOrder(upcoming.getId().toString(),
                        departed.getId().toString(), cancelled.getId().toString(), noShow.getId().toString())));
        mockMvc.perform(get(list).param("status", "HELD").with(manager(managerId)))
                .andExpect(jsonPath("$.content[*].reservationId").value(contains(held.getId().toString())));
        mockMvc.perform(get(list).param("status", "CONFIRMED,CANCELLED").with(manager(managerId)))
                .andExpect(jsonPath("$.totalElements").value(2));

        // Search: guest name, booking reference, confirmation number (any case).
        mockMvc.perform(get(list).param("q", "meera").with(manager(managerId)))
                .andExpect(jsonPath("$.content[*].reservationId").value(contains(upcoming.getId().toString())))
                .andExpect(jsonPath("$.content[0].leadGuest").value("Meera Iyer"))
                .andExpect(jsonPath("$.content[0].nights").value(2))
                .andExpect(jsonPath("$.content[0].rooms").value(2))
                .andExpect(jsonPath("$.content[0].roomTypeName").exists())
                .andExpect(jsonPath("$.content[0].ratePlanName").value("Flexible"))
                .andExpect(jsonPath("$.content[0].totalAmount").value(12600.00));
        mockMvc.perform(get(list).param("q", departed.getBookingReference().toLowerCase()).with(manager(managerId)))
                .andExpect(jsonPath("$.content[*].reservationId").value(contains(departed.getId().toString())));
        mockMvc.perform(get(list).param("q", cancelled.getConfirmationNumber()).with(manager(managerId)))
                .andExpect(jsonPath("$.content[*].reservationId").value(contains(cancelled.getId().toString())));

        // Phase 12: the counts above the list (every status, same filters), and the room type filter.
        String summary = list + "/summary";
        mockMvc.perform(get(summary).with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(4))
                .andExpect(jsonPath("$.confirmed").value(1))
                .andExpect(jsonPath("$.pending").value(1))
                .andExpect(jsonPath("$.checkedIn").value(0))
                .andExpect(jsonPath("$.checkedOut").value(1))
                .andExpect(jsonPath("$.cancelled").value(1))
                .andExpect(jsonPath("$.noShow").value(1));
        mockMvc.perform(get(summary).param("q", "meera").with(manager(managerId)))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.confirmed").value(1))
                .andExpect(jsonPath("$.cancelled").value(0));
        mockMvc.perform(get(summary).param("from", today.toString()).param("to", today.plusDays(10).toString())
                        .with(manager(managerId)))
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.pending").value(1));
        mockMvc.perform(get(list).param("roomTypeId", room.roomTypeId().toString()).with(manager(managerId)))
                .andExpect(jsonPath("$.totalElements").value(4));
        TestStays.Room otherRoom = stays.room(hotel.getId(), 2, "2000.00", today.minusDays(10), today.plusDays(40));
        mockMvc.perform(get(list).param("roomTypeId", otherRoom.roomTypeId().toString()).with(manager(managerId)))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get(summary).param("roomTypeId", otherRoom.roomTypeId().toString()).with(manager(managerId)))
                .andExpect(jsonPath("$.total").value(0))
                .andExpect(jsonPath("$.pending").value(0));
        // A room type of another hotel is never accepted as a filter.
        TestStays.Room strangerRoom = stays.room(stays.hotel("Another Desk Hotel", "Deskville").getId(), 2, "2000.00",
                today.minusDays(10), today.plusDays(40));
        mockMvc.perform(get(list).param("roomTypeId", strangerRoom.roomTypeId().toString()).with(manager(managerId)))
                .andExpect(status().isNotFound());
        mockMvc.perform(get(summary).param("roomTypeId", strangerRoom.roomTypeId().toString()).with(manager(managerId)))
                .andExpect(status().isNotFound());

        // Check-in dates (inclusive), or the booking date.
        mockMvc.perform(get(list).param("from", today.toString()).param("to", today.plusDays(10).toString())
                        .with(manager(managerId)))
                .andExpect(jsonPath("$.content[*].reservationId", containsInAnyOrder(upcoming.getId().toString(),
                        cancelled.getId().toString())));
        mockMvc.perform(get(list).param("dateField", "CREATED").param("from", today.toString())
                        .param("to", today.toString()).with(manager(managerId)))
                .andExpect(jsonPath("$.totalElements").value(4));
        mockMvc.perform(get(list).param("dateField", "CREATED").param("from", today.plusDays(1).toString())
                        .with(manager(managerId)))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get(list).param("from", today.toString()).param("to", today.minusDays(1).toString())
                        .with(manager(managerId)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_DATE_RANGE"));

        // Sorting (whitelisted fields) and paging.
        mockMvc.perform(get(list).param("sort", "checkIn,asc").with(manager(managerId)))
                .andExpect(jsonPath("$.content[*].reservationId").value(contains(departed.getId().toString(),
                        noShow.getId().toString(), upcoming.getId().toString(), cancelled.getId().toString())));
        mockMvc.perform(get(list).param("sort", "checkIn,asc").param("size", "3").param("page", "1")
                        .with(manager(managerId)))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.content[*].reservationId").value(contains(cancelled.getId().toString())));

        // Details: guests and contact for the front desk; who cancelled.
        mockMvc.perform(get(list + "/" + upcoming.getId()).with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.guests[*].firstName").value(contains("Meera", "Guest")))
                .andExpect(jsonPath("$.contactEmail").value(upcoming.getContactEmail()))
                .andExpect(jsonPath("$.contactPhone").value("+919800000000"))
                .andExpect(jsonPath("$.specialRequests").value("Late arrival, around 23:00"))
                .andExpect(jsonPath("$.confirmationNumber").value(upcoming.getConfirmationNumber()));
        mockMvc.perform(get(list + "/" + cancelled.getId()).with(manager(managerId)))
                .andExpect(jsonPath("$.cancelledBy").value("CUSTOMER"))
                .andExpect(jsonPath("$.cancellationReference").exists());
        mockMvc.perform(get(list + "/" + UUID.randomUUID()).with(manager(managerId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESERVATION_NOT_FOUND"));
    }

    // ------------------------------------------------------------------ check-in, check-out, no-show

    @Test
    void guestsAreCheckedInOnTheirDaysAndMayLeaveEarly() throws Exception {
        HotelReservation arriving = stays.stay(room, UUID.randomUUID(), today, today.plusDays(3),
                ReservationStatus.CONFIRMED);
        HotelReservation tomorrow = stays.stay(room, UUID.randomUUID(), today.plusDays(1), today.plusDays(2),
                ReservationStatus.CONFIRMED);
        HotelReservation over = stays.stay(room, UUID.randomUUID(), today.minusDays(4), today.minusDays(2),
                ReservationStatus.CONFIRMED);

        for (HotelReservation wrongDay : List.of(tomorrow, over)) {
            mockMvc.perform(post(action(wrongDay, "check-in")).with(manager(managerId)))
                    .andExpect(status().isUnprocessableContent())
                    .andExpect(jsonPath("$.code").value("NOT_CHECK_IN_DAY"));
        }
        mockMvc.perform(post(action(arriving, "check-out")).with(manager(managerId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_RESERVATION_STATE"))
                .andExpect(jsonPath("$.details.status").value("CONFIRMED"));

        mockMvc.perform(post(action(arriving, "check-in")).with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CHECKED_IN"))
                .andExpect(jsonPath("$.checkedInAt").exists());
        GuestCheckedIn checkedIn = single(arriving, GuestCheckedIn.class);
        assertThat(checkedIn.getReservationId()).isEqualTo(arriving.getId().toString());
        assertThat(checkedIn.getHotelId()).isEqualTo(hotel.getId().toString());
        mockMvc.perform(post(action(arriving, "check-in")).with(manager(managerId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_RESERVATION_STATE"));
        mockMvc.perform(post(action(arriving, "no-show")).with(manager(managerId)))
                .andExpect(status().isConflict());

        // Leaving on the first day: every night of the stay goes back on sale (tomorrow's other guest keeps theirs);
        // the stay is completed.
        assertThat(stays.bookedRooms(room, today, today.plusDays(3))).containsExactly(1, 2, 1);
        mockMvc.perform(post(action(arriving, "check-out")).with(admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CHECKED_OUT"))
                .andExpect(jsonPath("$.checkedOutAt").exists());
        assertThat(single(arriving, GuestCheckedOut.class).getBookingId()).isEqualTo(arriving.getBookingId().toString());
        assertThat(stays.bookedRooms(room, today, today.plusDays(3))).containsExactly(0, 1, 0);
    }

    @Test
    void aNoShowIsRecordedFromTheDayAfterCheckInAndFreesTheNightsToCome() throws Exception {
        HotelReservation arrivesToday = stays.stay(room, UUID.randomUUID(), today, today.plusDays(2),
                ReservationStatus.CONFIRMED);
        HotelReservation missed = stays.stay(room, UUID.randomUUID(), today.minusDays(1), today.plusDays(2),
                ReservationStatus.CONFIRMED);

        mockMvc.perform(post(action(arrivesToday, "no-show")).with(manager(managerId)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("NO_SHOW_TOO_EARLY"));

        mockMvc.perform(post(action(missed, "no-show")).with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("NO_SHOW"))
                .andExpect(jsonPath("$.noShowAt").exists());
        // Last night stays sold; tonight and tomorrow are back on sale (only the other stay's room remains).
        assertThat(stays.bookedRooms(room, today.minusDays(1), today.plusDays(2))).containsExactly(1, 1, 1);
        assertThat(stays.hotelEvents(missed.getBookingId())).isEmpty();
        AuditEventRecorded audit = stays.auditEvents(missed.getId()).getFirst();
        assertThat(audit.getAction()).isEqualTo("HOTEL_RESERVATION_NO_SHOW");
        assertThat(audit.getDetails()).containsEntry("nightsBackOnSale", "2");
        mockMvc.perform(post(action(missed, "check-in")).with(manager(managerId)))
                .andExpect(status().isConflict());
    }

    // ------------------------------------------------------------------ the hotel cancels

    @Test
    void theHotelCancelsAConfirmedStayAndTheGuestIsRefundedInFull() throws Exception {
        HotelReservation stay = stays.stay(room, UUID.randomUUID(), today.plusDays(5), today.plusDays(7), 2,
                "12000.00", ReservationStatus.CONFIRMED, "Asha", "Rao");
        HotelReservation started = stays.stay(room, UUID.randomUUID(), today.minusDays(2), today.plusDays(1),
                ReservationStatus.CONFIRMED);
        HotelReservation inHouse = stays.stay(room, UUID.randomUUID(), today.minusDays(1), today.plusDays(1),
                ReservationStatus.CHECKED_IN);
        assertThat(stays.bookedRooms(room, today.plusDays(5), today.plusDays(7))).containsExactly(2, 2);

        mockMvc.perform(post(action(stay, "cancel")).with(manager(managerId)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Oops\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mockMvc.perform(post(action(stay, "cancel")).with(manager(managerId)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Water damage in the east wing\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.cancelledBy").value("HOTEL"))
                .andExpect(jsonPath("$.cancellationReason").value("Water damage in the east wing"))
                .andExpect(jsonPath("$.cancellationReference").value(org.hamcrest.Matchers.matchesPattern(
                        "HX[2-9A-HJ-NP-Z]{8}")));

        assertThat(stays.bookedRooms(room, today.plusDays(5), today.plusDays(7))).containsExactly(0, 0);
        HotelReservationCancelled cancelled = single(stay, HotelReservationCancelled.class);
        HotelReservation saved = reservations.findById(stay.getId()).orElseThrow();
        assertThat(cancelled.getInitiatedBy()).isEqualTo("HOTEL");
        assertThat(cancelled.getReason()).isEqualTo("Water damage in the east wing");
        assertThat(cancelled.getCancellationId()).isEqualTo(saved.getCancellationId().toString());
        assertThat(cancelled.getCancellationReference()).isEqualTo(saved.getCancellationReference());
        AuditEventRecorded audit = stays.auditEvents(stay.getId()).getFirst();
        assertThat(audit.getAction()).isEqualTo("HOTEL_RESERVATION_CANCELLED");
        assertThat(audit.getDetails()).containsEntry("initiatedBy", "HOTEL").containsEntry("rooms", "2")
                .doesNotContainKey("reason");

        mockMvc.perform(post(action(stay, "cancel")).with(manager(managerId)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Water damage in the east wing\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_RESERVATION_STATE"));
        mockMvc.perform(post(action(started, "cancel")).with(manager(managerId)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Water damage in the east wing\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("TOO_LATE_TO_CANCEL"));
        mockMvc.perform(post(action(inHouse, "cancel")).with(manager(managerId)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Water damage in the east wing\"}"))
                .andExpect(status().isConflict());
        assertThat(stays.hotelEvents(started.getBookingId())).isEmpty();
    }

    // ------------------------------------------------------------------ helpers

    private String action(HotelReservation reservation, String action) {
        return "/api/hotel-manager/hotels/" + hotel.getId() + "/reservations/" + reservation.getId() + "/" + action;
    }

    private <T> T single(HotelReservation reservation, Class<T> type) {
        List<Object> matching = stays.hotelEvents(reservation.getBookingId()).stream().filter(type::isInstance).toList();
        assertThat(matching).as("%s events for booking %s", type.getSimpleName(), reservation.getBookingId()).hasSize(1);
        return type.cast(matching.getFirst());
    }
}
