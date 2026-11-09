package com.flighthotel.hotel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.events.audit.AuditEventRecorded;
import com.flighthotel.events.booking.BookingCancellationRequested;
import com.flighthotel.events.booking.BookingExpired;
import com.flighthotel.events.booking.BookingFailed;
import com.flighthotel.events.booking.BookingInitiated;
import com.flighthotel.events.booking.BookingPaid;
import com.flighthotel.events.booking.HotelBookingRequest;
import com.flighthotel.events.booking.HotelGuest;
import com.flighthotel.events.hotel.HotelInventoryHeld;
import com.flighthotel.events.hotel.HotelInventoryHoldFailed;
import com.flighthotel.events.hotel.HotelInventoryReleased;
import com.flighthotel.events.hotel.HotelReservationCancellationFailed;
import com.flighthotel.events.hotel.HotelReservationCancelled;
import com.flighthotel.events.hotel.HotelReservationConfirmed;
import com.flighthotel.events.hotel.HotelReservationFailed;
import com.flighthotel.hotel.entity.CancelledBy;
import com.flighthotel.hotel.entity.DataSource;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelReservation;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.entity.PropertyType;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.messaging.BookingEventsListener;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.HotelReservationRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.scheduler.HoldExpiryJob;
import com.flighthotel.hotel.support.Uuids;
import com.jayway.jsonpath.JsonPath;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/**
 * Phase 5 exit check, hotel side: every hotel failure path of BOOKING_WORKFLOW.md §2. booking-service's events are
 * handed to the real listener (inbox + transaction), and hotel-service's answers are read back from the outbox and
 * decoded exactly as consumers would see them.
 */
class HotelBookingSagaIntegrationTest extends HotelIntegrationTest {

    private static final KafkaAvroDeserializer AVRO = new KafkaAvroDeserializer();

    static {
        AVRO.configure(Map.of("schema.registry.url", "mock://hotel-it", "specific.avro.reader", true), false);
    }

    @Autowired
    BookingEventsListener listener;

    @Autowired
    HoldExpiryJob expiryJob;

    @Autowired
    HotelRepository hotels;

    @Autowired
    RoomTypeRepository roomTypes;

    @Autowired
    RatePlanRepository ratePlans;

    @Autowired
    HotelReservationRepository reservations;

    @Autowired
    TransactionTemplate transactions;

    private UUID hotelId;

    @BeforeEach
    void testHotel() {
        // Own hotel (not in the search index, unknown city) so the demo catalogue other tests use stays untouched.
        hotelId = transactions.execute(status -> {
            Hotel hotel = new Hotel("Saga Test Hotel " + UUID.randomUUID(), "saga-test-" + UUID.randomUUID(),
                    PropertyType.HOTEL, "1 Test Road", "Sagaville", "IN", DataSource.INTERNAL);
            hotel.changeStatus(HotelStatus.ACTIVE);
            return hotels.saveAndFlush(hotel).getId();
        });
    }

    // ------------------------------------------------------------------ happy path

    @Test
    void heldRoomsAreConfirmedWhenTheBookingIsPaid() throws Exception {
        Room room = newRoom(2, "3000.00");
        LocalDate checkIn = offPeak(30);
        String quoteId = quote(room, checkIn, 2, 1);
        UUID bookingId = UuidV7.generate();

        listener.handle(eventId(), initiated(bookingId, quoteId, 1));

        HotelInventoryHeld held = single(bookingId, HotelInventoryHeld.class);
        // 3000 × 2 nights = 6000 + GST 5 % (150 per night) = 6300
        assertThat(held.getSubtotal().getAmount()).isEqualByComparingTo("6000.00");
        assertThat(held.getTaxes().getAmount()).isEqualByComparingTo("300.00");
        assertThat(held.getTotal().getAmount()).isEqualByComparingTo("6300.00");
        assertThat(held.getTaxLines()).singleElement()
                .satisfies(line -> assertThat(line.getLabel()).isEqualTo("GST 5%"));
        assertThat(held.getNights()).isEqualTo(2);
        assertThat(held.getRefundable()).isTrue();
        assertThat(held.getFreeCancellationUntil()).isNotNull();
        assertThat(held.getCancellationPolicy()).startsWith("Free cancellation until");
        assertThat(held.getHotelCity()).isEqualTo("Sagaville");
        assertThat(Duration.between(Instant.now(), held.getHoldExpiresAt()))
                .isBetween(Duration.ofMinutes(19), Duration.ofMinutes(21));
        assertThat(nights(room, checkIn, 2)).containsOnly(new Night(0, 1));
        HotelReservation reservation = reservations.findByBookingId(bookingId).orElseThrow();
        assertThat(reservation.getStatus()).isEqualTo(ReservationStatus.HELD);
        assertThat(guests(reservation.getId())).containsExactly("Asha Rao");

        listener.handle(eventId(), paid(bookingId));

        HotelReservationConfirmed confirmed = single(bookingId, HotelReservationConfirmed.class);
        assertThat(confirmed.getConfirmationNumber()).matches("H[2-9A-HJ-NP-Z]{9}");
        assertThat(nights(room, checkIn, 2)).containsOnly(new Night(1, 0));
        assertThat(reservations.findByBookingId(bookingId).orElseThrow().getStatus())
                .isEqualTo(ReservationStatus.CONFIRMED);
    }

    @Test
    void theSameEventDeliveredTwiceIsHandledOnce() throws Exception {
        Room room = newRoom(3, "2500.00");
        LocalDate checkIn = offPeak(35);
        UUID bookingId = UuidV7.generate();
        String eventId = eventId();
        BookingInitiated event = initiated(bookingId, quote(room, checkIn, 1, 1), 1);

        listener.handle(eventId, event);
        listener.handle(eventId, event);
        // Even a second, different BookingInitiated for the same booking never holds twice.
        listener.handle(eventId(), event);

        assertThat(answers(bookingId)).hasSize(1).first().isInstanceOf(HotelInventoryHeld.class);
        assertThat(nights(room, checkIn, 1)).containsOnly(new Night(0, 1));
    }

    // ------------------------------------------------------------------ failures before payment

    @Test
    void anExpiredQuoteHoldsNothing() {
        UUID bookingId = UuidV7.generate();

        listener.handle(eventId(), initiated(bookingId, UUID.randomUUID().toString(), 1));

        HotelInventoryHoldFailed failed = single(bookingId, HotelInventoryHoldFailed.class);
        assertThat(failed.getReason()).isEqualTo("QUOTE_EXPIRED");
        assertThat(failed.getMessage()).contains("expired");
        assertThat(reservations.findByBookingId(bookingId)).isEmpty();
    }

    @Test
    void roomsSoldOutBetweenQuoteAndBooking() throws Exception {
        Room room = newRoom(1, "2000.00");
        LocalDate checkIn = offPeak(40);
        String firstQuote = quote(room, checkIn, 2, 1);
        String secondQuote = quote(room, checkIn, 2, 1);
        UUID first = UuidV7.generate();
        UUID second = UuidV7.generate();

        listener.handle(eventId(), initiated(first, firstQuote, 1));
        listener.handle(eventId(), initiated(second, secondQuote, 1));

        assertThat(single(first, HotelInventoryHeld.class)).isNotNull();
        HotelInventoryHoldFailed failed = single(second, HotelInventoryHoldFailed.class);
        assertThat(failed.getReason()).isEqualTo("SOLD_OUT");
        assertThat(failed.getHotelName()).startsWith("Saga Test Hotel");
        // The losing booking changed nothing: still exactly one room held per night.
        assertThat(nights(room, checkIn, 2)).containsOnly(new Night(0, 1));
        assertThat(reservations.findByBookingId(second)).isEmpty();
    }

    @Test
    void priceChangedSinceTheQuote() throws Exception {
        Room room = newRoom(2, "2000.00");
        LocalDate checkIn = offPeak(45);
        String quoteId = quote(room, checkIn, 1, 1);
        transactions.executeWithoutResult(status -> {
            RatePlan plan = ratePlans.findById(room.ratePlanId()).orElseThrow();
            plan.setBasePricePerNight(new BigDecimal("2200.00"));
        });
        UUID bookingId = UuidV7.generate();

        listener.handle(eventId(), initiated(bookingId, quoteId, 1));

        HotelInventoryHoldFailed failed = single(bookingId, HotelInventoryHoldFailed.class);
        assertThat(failed.getReason()).isEqualTo("PRICE_CHANGED");
        // 2200 + GST 5 % = 2310
        assertThat(failed.getNewTotal().getAmount()).isEqualByComparingTo("2310.00");
        assertThat(nights(room, checkIn, 1)).containsOnly(new Night(0, 0));
    }

    @Test
    void oneGuestNameIsNeededPerRoom() throws Exception {
        Room room = newRoom(3, "1800.00");
        String quoteId = quote(room, offPeak(50), 1, 2);
        UUID bookingId = UuidV7.generate();

        listener.handle(eventId(), initiated(bookingId, quoteId, 1));

        assertThat(single(bookingId, HotelInventoryHoldFailed.class).getReason()).isEqualTo("INVALID_GUESTS");
    }

    @Test
    void aFailedBookingGivesItsHeldRoomsBack() throws Exception {
        Room room = newRoom(1, "2000.00");
        LocalDate checkIn = offPeak(55);
        UUID bookingId = UuidV7.generate();
        listener.handle(eventId(), initiated(bookingId, quote(room, checkIn, 1, 1), 1));

        listener.handle(eventId(), BookingFailed.newBuilder().setBookingId(bookingId.toString())
                .setBookingType("HOTEL").setReason("NO_RESPONSE").setFailedAt(Instant.now()).build());

        assertThat(single(bookingId, HotelInventoryReleased.class).getReason()).isEqualTo("BOOKING_FAILED");
        assertThat(nights(room, checkIn, 1)).containsOnly(new Night(0, 0));
        // Telling a released reservation to release again does nothing.
        listener.handle(eventId(), BookingExpired.newBuilder().setBookingId(bookingId.toString())
                .setBookingType("HOTEL").setExpiredAt(Instant.now()).build());
        assertThat(answers(bookingId)).hasSize(2);
    }

    // ------------------------------------------------------------------ the customer does not pay in time

    @Test
    void anUnpaidHoldExpiresAndALatePaymentStillGetsTheRoomsIfTheyAreFree() throws Exception {
        Room room = newRoom(1, "2000.00");
        LocalDate checkIn = offPeak(60);
        UUID bookingId = UuidV7.generate();
        listener.handle(eventId(), initiated(bookingId, quote(room, checkIn, 2, 1), 1));
        expireHold(bookingId);

        expiryJob.releaseExpiredHolds();

        assertThat(single(bookingId, HotelInventoryReleased.class).getReason()).isEqualTo("EXPIRED");
        assertThat(nights(room, checkIn, 2)).containsOnly(new Night(0, 0));
        assertThat(reservations.findByBookingId(bookingId).orElseThrow().getStatus())
                .isEqualTo(ReservationStatus.EXPIRED);

        // Payment arrives within the grace time booking-service allows; the rooms are still free → confirmed.
        listener.handle(eventId(), paid(bookingId));

        assertThat(single(bookingId, HotelReservationConfirmed.class).getConfirmationNumber()).isNotBlank();
        assertThat(nights(room, checkIn, 2)).containsOnly(new Night(1, 0));
    }

    @Test
    void aLatePaymentForRoomsSoldMeanwhileFailsSoTheCustomerIsRefunded() throws Exception {
        Room room = newRoom(1, "2000.00");
        LocalDate checkIn = offPeak(65);
        UUID late = UuidV7.generate();
        listener.handle(eventId(), initiated(late, quote(room, checkIn, 1, 1), 1));
        expireHold(late);
        expiryJob.releaseExpiredHolds();
        UUID other = UuidV7.generate();
        listener.handle(eventId(), initiated(other, quote(room, checkIn, 1, 1), 1));

        listener.handle(eventId(), paid(late));

        assertThat(single(late, HotelReservationFailed.class).getReason()).isEqualTo("ROOMS_RELEASED");
        // The other customer's hold is untouched.
        assertThat(nights(room, checkIn, 1)).containsOnly(new Night(0, 1));
        assertThat(reservations.findByBookingId(late).orElseThrow().getStatus()).isEqualTo(ReservationStatus.EXPIRED);
    }

    @Test
    void theExpiryJobLeavesHoldsThatAreStillValid() throws Exception {
        Room room = newRoom(1, "2000.00");
        LocalDate checkIn = offPeak(70);
        UUID bookingId = UuidV7.generate();
        listener.handle(eventId(), initiated(bookingId, quote(room, checkIn, 1, 1), 1));

        expiryJob.releaseExpiredHolds();

        assertThat(answers(bookingId)).hasSize(1);
        assertThat(nights(room, checkIn, 1)).containsOnly(new Night(0, 1));
    }

    // ------------------------------------------------------------------ cancellations (Phase 7)

    @Test
    void aConfirmedStayCancelledBeforeCheckInGivesTheBookedRoomsBack() throws Exception {
        Room room = newRoom(2, "3000.00");
        LocalDate checkIn = offPeak(40);
        UUID bookingId = UuidV7.generate();
        listener.handle(eventId(), initiated(bookingId, quote(room, checkIn, 2, 1), 1));
        // The check-in moment travels with the hold: 14:00 hotel local time (the test hotel is in India).
        assertThat(single(bookingId, HotelInventoryHeld.class).getCheckInAt())
                .isEqualTo(checkIn.atTime(14, 0).atZone(java.time.ZoneId.of("Asia/Kolkata")).toInstant());
        listener.handle(eventId(), paid(bookingId));
        assertThat(nights(room, checkIn, 2)).containsOnly(new Night(1, 0));

        UUID cancellationId = UuidV7.generate();
        listener.handle(eventId(), cancel(bookingId, cancellationId, Instant.now()));

        HotelReservationCancelled cancelled = single(bookingId, HotelReservationCancelled.class);
        assertThat(cancelled.getCancellationId()).isEqualTo(cancellationId.toString());
        assertThat(cancelled.getCancellationReference()).matches("HX[2-9A-HJ-NP-Z]{8}");
        assertThat(cancelled.getInitiatedBy()).isEqualTo("CUSTOMER");
        assertThat(cancelled.getReason()).isNull();
        assertThat(nights(room, checkIn, 2)).containsOnly(new Night(0, 0));
        HotelReservation reservation = reservations.findByBookingId(bookingId).orElseThrow();
        assertThat(reservation.getStatus()).isEqualTo(ReservationStatus.CANCELLED);
        assertThat(reservation.getCancelledAt()).isNotNull();
        assertThat(reservation.getCancelledBy()).isEqualTo(CancelledBy.CUSTOMER);
        AuditEventRecorded audit = auditEvents(reservation.getId()).getFirst();
        assertThat(audit.getAction()).isEqualTo("HOTEL_RESERVATION_CANCELLED");
        assertThat(audit.getDetails()).containsEntry("cancellationId", cancellationId.toString())
                .containsEntry("rooms", "1").doesNotContainKey("contactEmail");

        // Asked again (booking-service's reconciliation): the same answer, the rooms are not given back twice.
        listener.handle(eventId(), cancel(bookingId, cancellationId, Instant.now()));
        List<HotelReservationCancelled> answers = answers(bookingId).stream()
                .filter(HotelReservationCancelled.class::isInstance).map(HotelReservationCancelled.class::cast).toList();
        assertThat(answers).hasSize(2).extracting(HotelReservationCancelled::getCancellationReference)
                .containsOnly(cancelled.getCancellationReference());
        assertThat(nights(room, checkIn, 2)).containsOnly(new Night(0, 0));
        assertThat(auditEvents(reservation.getId())).hasSize(1);
    }

    @Test
    void aStayIsOnlyCancelledWhenConfirmedAndBeforeTheCheckInTime() throws Exception {
        Room room = newRoom(3, "2000.00");
        LocalDate checkIn = offPeak(45);
        UUID heldOnly = UuidV7.generate();
        UUID confirmed = UuidV7.generate();
        listener.handle(eventId(), initiated(heldOnly, quote(room, checkIn, 1, 1), 1));
        listener.handle(eventId(), initiated(confirmed, quote(room, checkIn, 1, 1), 1));
        listener.handle(eventId(), paid(confirmed));

        // Not confirmed (only held), and a booking the hotel never heard of.
        listener.handle(eventId(), cancel(heldOnly, UuidV7.generate(), Instant.now()));
        UUID unknown = UuidV7.generate();
        listener.handle(eventId(), cancel(unknown, UuidV7.generate(), Instant.now()));
        assertThat(single(heldOnly, HotelReservationCancellationFailed.class).getReason()).isEqualTo("NOT_CANCELLABLE");
        assertThat(single(unknown, HotelReservationCancellationFailed.class).getReason()).isEqualTo("NOT_CANCELLABLE");

        // Asked after the check-in time (14:00 hotel local time): refused, the rooms stay booked.
        Instant afterCheckIn = checkIn.atTime(14, 1).atZone(java.time.ZoneId.of("Asia/Kolkata")).toInstant();
        listener.handle(eventId(), cancel(confirmed, UuidV7.generate(), afterCheckIn));
        HotelReservationCancellationFailed tooLate = single(confirmed, HotelReservationCancellationFailed.class);
        assertThat(tooLate.getReason()).isEqualTo("TOO_LATE");
        assertThat(tooLate.getMessage()).contains("check-in time has passed");
        assertThat(reservations.findByBookingId(confirmed).orElseThrow().getStatus())
                .isEqualTo(ReservationStatus.CONFIRMED);
        assertThat(nights(room, checkIn, 1)).containsOnly(new Night(1, 1));

        // One minute before check-in is still in time.
        listener.handle(eventId(), cancel(confirmed, UuidV7.generate(), afterCheckIn.minusSeconds(120)));
        assertThat(single(confirmed, HotelReservationCancelled.class)).isNotNull();
        assertThat(nights(room, checkIn, 1)).containsOnly(new Night(0, 1));
    }

    // ------------------------------------------------------------------ helpers

    private static BookingCancellationRequested cancel(UUID bookingId, UUID cancellationId, Instant requestedAt) {
        return BookingCancellationRequested.newBuilder().setBookingId(bookingId.toString())
                .setBookingReference("HT-CANCEL01").setBookingType("HOTEL")
                .setCancellationId(cancellationId.toString()).setInitiatedBy("CUSTOMER")
                .setRequestedAt(requestedAt).build();
    }

    private List<AuditEventRecorded> auditEvents(UUID entityId) {
        return jdbcClient.sql("""
                        SELECT payload FROM outbox_events WHERE aggregate_type = 'audit' AND aggregate_id = :id
                        ORDER BY created_at, id""")
                .param("id", entityId.toString())
                .query((rs, i) -> (AuditEventRecorded) AVRO.deserialize("audit.events", rs.getBytes("payload")))
                .list();
    }

    private record Room(UUID roomTypeId, UUID ratePlanId) {
    }

    private record Night(int booked, int held) {
    }

    /** A refundable room type with its own inventory in the test hotel. */
    private Room newRoom(int totalRooms, String price) {
        return transactions.execute(status -> {
            RoomType room = new RoomType(hotelId);
            room.setName("Saga room " + UUID.randomUUID());
            room.setMaxAdults(2);
            room.setMaxChildren(1);
            room.setBedConfiguration("1 Queen bed");
            room.setTotalRooms(totalRooms);
            roomTypes.saveAndFlush(room);
            inventory.initialize(room.getId(), totalRooms);
            RatePlan plan = new RatePlan(room.getId());
            plan.setName("Flexible");
            plan.setBasePricePerNight(new BigDecimal(price));
            plan.setCancellation(true, 48, BigDecimal.valueOf(50));
            ratePlans.saveAndFlush(plan);
            return new Room(room.getId(), plan.getId());
        });
    }

    private String quote(Room room, LocalDate checkIn, int nights, int rooms) throws Exception {
        String body = mockMvc.perform(post("/api/hotels/availability").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"hotelId":"%s","roomTypeId":"%s","ratePlanId":"%s",
                                 "stay":{"checkIn":"%s","checkOut":"%s","rooms":%d,"adults":%d,"children":0}}"""
                                .formatted(hotelId, room.roomTypeId(), room.ratePlanId(), checkIn,
                                        checkIn.plusDays(nights), rooms, rooms)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.quoteId");
    }

    private static BookingInitiated initiated(UUID bookingId, String quoteId, int guests) {
        List<HotelGuest> names = new ArrayList<>();
        for (int room = 1; room <= guests; room++) {
            names.add(HotelGuest.newBuilder().setRoomNo(room).setFirstName(room == 1 ? "Asha" : "Guest")
                    .setLastName(room == 1 ? "Rao" : "Number" + room).build());
        }
        return BookingInitiated.newBuilder()
                .setBookingId(bookingId.toString())
                .setBookingReference("HT-TEST" + bookingId.toString().substring(0, 4).toUpperCase())
                .setUserId(UUID.randomUUID().toString())
                .setBookingType("HOTEL")
                .setHotel(HotelBookingRequest.newBuilder()
                        .setQuoteId(quoteId)
                        .setGuests(names)
                        .setContactEmail("asha@example.com")
                        .setContactPhone("+919800000000")
                        .build())
                .setInitiatedAt(Instant.now())
                .build();
    }

    private static BookingPaid paid(UUID bookingId) {
        return BookingPaid.newBuilder().setBookingId(bookingId.toString()).setBookingType("HOTEL")
                .setPaymentId(UUID.randomUUID().toString()).setPaidAt(Instant.now()).build();
    }

    private static String eventId() {
        return UuidV7.generate().toString();
    }

    /** Moves the hold's end into the past (UTC, like Hibernate stores it; the test JDBC URL has no time zone). */
    private void expireHold(UUID bookingId) {
        jdbcClient.sql("""
                        UPDATE hotel_reservations SET hold_expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE
                        WHERE booking_id = :id""")
                .param("id", Uuids.param(bookingId))
                .update();
    }

    /** hotel-service's answers for one booking, decoded from the outbox like a Kafka consumer would. */
    private List<Object> answers(UUID bookingId) {
        return jdbcClient.sql("""
                        SELECT payload FROM outbox_events WHERE aggregate_type = 'hotel' AND aggregate_id = :id
                        ORDER BY created_at, id""")
                .param("id", bookingId.toString())
                .query((rs, i) -> AVRO.deserialize("hotel.events", rs.getBytes("payload")))
                .list();
    }

    private <T> T single(UUID bookingId, Class<T> type) {
        List<Object> matching = answers(bookingId).stream().filter(type::isInstance).toList();
        assertThat(matching).as("%s events for booking %s", type.getSimpleName(), bookingId).hasSize(1);
        return type.cast(matching.getFirst());
    }

    private List<Night> nights(Room room, LocalDate checkIn, int nights) {
        return jdbcClient.sql("""
                        SELECT booked_rooms, held_rooms FROM room_inventory WHERE room_type_id = :id
                        AND stay_date >= :from AND stay_date < :to ORDER BY stay_date""")
                .param("id", Uuids.param(room.roomTypeId()))
                .param("from", checkIn)
                .param("to", checkIn.plusDays(nights))
                .query((rs, i) -> new Night(rs.getInt(1), rs.getInt(2)))
                .list();
    }

    private List<String> guests(UUID reservationId) {
        return jdbcClient.sql("""
                        SELECT CONCAT(first_name, ' ', last_name) FROM hotel_reservation_guests
                        WHERE reservation_id = :id ORDER BY room_no""")
                .param("id", Uuids.param(reservationId))
                .query(String.class)
                .list();
    }
}
