package com.flighthotel.booking.devseed;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.booking.dto.BookingDtos.SegmentView;
import com.flighthotel.booking.dto.BookingDtos.SliceView;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.service.BookingSnapshots;
import com.flighthotel.common.dev.DevIds;
import com.flighthotel.common.dev.DevScenario;
import com.flighthotel.common.dev.DevScenario.Leg;
import com.flighthotel.common.dev.DevScenario.Outcome;
import com.flighthotel.common.dev.DevScenario.Person;
import com.flighthotel.common.dev.DevScenario.Stay;
import com.flighthotel.common.dev.DevScenario.Traveller;
import com.flighthotel.common.dev.DevScenario.Trip;
import com.flighthotel.common.dev.DevSeed;
import com.flighthotel.common.persistence.SecurityAuditorAware;

import tools.jackson.databind.json.JsonMapper;

/**
 * <b>Development only</b> ({@code booking.dev-seed.enabled=true}, environment variable {@code DEV_SEED_ENABLED};
 * refuses to run in the {@code prod} profile). The hotel and flight bookings of the two development customers in
 * every state ({@link DevScenario}): price lines, guests and passengers, status history, cancellations and refund
 * requests, with the same ids, references and amounts as the reservations in hotel-service and the supplier bookings
 * in flight-service.
 * <p>
 * Rows are inserted directly: the booking saga does not run, so no payment, e-mail or reminder is triggered. Only the
 * booking snapshot is published (the same one every booking change publishes) so the admin reports know the bookings.
 * A booking whose id exists is skipped, so a second run changes nothing.
 */
@Component
@Order(20)
@ConditionalOnProperty(prefix = "booking.dev-seed", name = "enabled", havingValue = "true")
public class DevBookingSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevBookingSeeder.class);
    private static final String BY = SecurityAuditorAware.SYSTEM;
    private static final String DOT = "·";

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final BookingRepository bookings;
    private final BookingSnapshots snapshots;
    private final JsonMapper json;
    private final Environment environment;
    private final Clock clock;

    public DevBookingSeeder(JdbcClient jdbc, TransactionTemplate transactions, BookingRepository bookings,
            BookingSnapshots snapshots, JsonMapper json, Environment environment, Clock clock) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.bookings = bookings;
        this.snapshots = snapshots;
        this.json = json;
        this.environment = environment;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!DevSeed.allowed(environment, log, "booking-service")) {
            return;
        }
        Instant now = clock.instant();
        LocalDate today = DevScenario.today(clock);
        int created = 0;
        for (Stay stay : DevScenario.STAYS) {
            Boolean added = transactions.execute(status -> seedStay(stay, now, today));
            created += Boolean.TRUE.equals(added) ? 1 : 0;
        }
        for (Trip trip : DevScenario.TRIPS) {
            Boolean added = transactions.execute(status -> seedTrip(trip, now, today));
            created += Boolean.TRUE.equals(added) ? 1 : 0;
        }
        transactions.executeWithoutResult(status -> notes(now));
        log.info("Development bookings ready: {} new, {} in the scenario", created,
                DevScenario.STAYS.size() + DevScenario.TRIPS.size());
    }

    // ------------------------------------------------------------------ hotel bookings

    private boolean seedStay(Stay stay, Instant now, LocalDate today) {
        if (exists(stay.bookingId())) {
            return false;
        }
        Person guest = stay.person();
        Outcome outcome = stay.outcome();
        var price = stay.price();
        Instant booked = stay.bookedAt(now);
        LocalDate checkIn = stay.checkIn(today);
        LocalDate checkOut = stay.checkOut(today);
        Instant checkInAt = stay.checkInAt(today);
        var hotel = stay.hotelDef();
        var room = stay.roomDef();

        BookingRow row = new BookingRow();
        row.id = stay.bookingId();
        row.reference = stay.reference();
        row.user = guest;
        row.type = "HOTEL";
        row.outcome = outcome;
        row.title = hotel.name();
        row.destination = hotel.city();
        row.startDate = checkIn;
        row.endDate = checkOut;
        row.base = price.subtotal();
        row.tax = price.taxes();
        row.total = price.total();
        row.refunded = stay.refund();
        row.booked = booked;
        row.paymentId = stay.paymentId();
        row.source = "INTERNAL";
        row.policy = stay.cancellationPolicy(today);
        row.cancelUntil = checkInAt;
        row.startsAt = checkInAt;
        row.cancelledAt = stay.cancelledAt(now, today);
        row.completedAt = checkOut.atTime(DevScenario.CHECK_OUT).atZone(DevScenario.INDIA).toInstant();
        row.confirmedWord = "the hotel";
        row.cancelledByHotel = outcome == Outcome.CANCELLED_BY_HOTEL;
        row.key = stay.key();
        row.refundFee = stay.cancellationFee();
        row.supplierReference = DevIds.code("HX", stay.key(), 8);
        insertBooking(row, now);

        List<String[]> items = new ArrayList<>();
        items.add(new String[] {"ROOM", "Room charges " + DOT + " " + stay.nights() + (stay.nights() == 1 ? " night" : " nights")
                + " × " + stay.rooms() + (stay.rooms() == 1 ? " room" : " rooms"), price.subtotal().toPlainString()});
        price.taxByRate().forEach((rate, amount) -> items.add(
                new String[] {"TAX", "GST " + rate.toPlainString() + "%", amount.toPlainString()}));
        priceItems(stay.bookingId(), items);

        jdbc.sql("""
                        INSERT INTO hotel_bookings (booking_id, quote_id, reservation_id, hotel_id, hotel_slug, hotel_name,
                          hotel_city, hotel_address, country_code, room_type_id, room_type_name, rate_plan_name,
                          breakfast_included, check_in, check_out, check_in_time, check_out_time, nights, rooms, adults,
                          children, confirmation_number, refundable, free_cancellation_until, cancellation_fee_percent,
                          special_requests, demo)
                        VALUES (:id, :quote, :reservation, :hotel, :slug, :name, :city, :address, 'IN', :room, :roomName,
                          :plan, :breakfast, :checkIn, :checkOut, '14:00', '11:00', :nights, :rooms, :adults, :children,
                          :confirmation, :refundable, :freeUntil, :fee, :requests, FALSE)""")
                .param("id", DevIds.bytes(stay.bookingId())).param("quote", DevIds.bytes(stay.quoteId()))
                .param("reservation", DevIds.bytes(stay.reservationId())).param("hotel", DevIds.bytes(hotel.id()))
                .param("slug", hotel.slug()).param("name", hotel.name()).param("city", hotel.city())
                .param("address", hotel.address() + ", " + hotel.city()).param("room", DevIds.bytes(room.id()))
                .param("roomName", room.name()).param("plan", room.planName(stay.flex())).param("breakfast", stay.flex())
                .param("checkIn", Date.valueOf(checkIn)).param("checkOut", Date.valueOf(checkOut))
                .param("nights", stay.nights()).param("rooms", stay.rooms()).param("adults", stay.adults())
                .param("children", stay.children())
                .param("confirmation", outcome.paid() ? stay.confirmationNumber() : null)
                .param("refundable", stay.flex())
                .param("freeUntil", ts(stay.freeCancellationUntil(today)))
                .param("fee", BigDecimal.valueOf(stay.feePercent())).param("requests", stay.requests()).update();
        List<String[]> names = stay.guests();
        for (int i = 0; i < stay.rooms(); i++) {
            String[] name = names.get(Math.min(i, names.size() - 1));
            jdbc.sql("INSERT INTO booking_guests (booking_id, room_no, first_name, last_name) "
                            + "VALUES (:id, :no, :first, :last)")
                    .param("id", DevIds.bytes(stay.bookingId())).param("no", i + 1).param("first", name[0])
                    .param("last", name[1]).update();
        }
        history(row, "Rooms held at the quoted price", "Confirming with the hotel", "Confirmed by the hotel");
        cancellationRows(row, stay.reservationId() != null, now);
        publish(stay.bookingId());
        return true;
    }

    // ------------------------------------------------------------------ flight bookings

    private boolean seedTrip(Trip trip, Instant now, LocalDate today) {
        if (exists(trip.bookingId())) {
            return false;
        }
        Person customer = trip.person();
        Outcome outcome = trip.outcome();
        var price = trip.price();
        Instant booked = trip.bookedAt(now);
        Leg first = trip.legs().getFirst();
        Leg last = trip.legs().getLast();
        Instant departure = trip.departureAt(today);
        List<SliceView> slices = trip.legs().stream().map(leg -> slice(leg, today)).toList();

        BookingRow row = new BookingRow();
        row.id = trip.bookingId();
        row.reference = trip.reference();
        row.user = customer;
        row.type = "FLIGHT";
        row.outcome = outcome;
        row.title = trip.title();
        row.destination = DevScenario.airport(first.def().destination()).city();
        row.startDate = first.date(today);
        row.endDate = LocalDateTime.parse(slices.getLast().arrivalLocal()).toLocalDate();
        row.base = price.subtotal();
        row.tax = price.taxes();
        row.total = price.total();
        row.refunded = trip.refund();
        row.booked = booked;
        row.paymentId = trip.paymentId();
        row.source = "DEMO";
        row.policy = trip.cancellationPolicy();
        row.cancelUntil = departure.minus(4, ChronoUnit.HOURS);
        row.startsAt = departure;
        row.cancelledAt = trip.cancelledAt(today);
        row.completedAt = last.def().departureAt(last.date(today)).plus(last.def().durationMinutes(), ChronoUnit.MINUTES);
        row.confirmedWord = "the airline";
        row.key = trip.key();
        row.refundFee = trip.cancellationFee();
        row.supplierReference = DevIds.code("DX", trip.key(), 8);
        insertBooking(row, now);

        List<String[]> items = new ArrayList<>();
        for (var line : price.lines()) {
            String type = line.label().startsWith("Fare") ? "FARE" : line.label().startsWith("GST") ? "TAX" : "FEE";
            items.add(new String[] {type, line.label(), line.amount().toPlainString()});
        }
        priceItems(trip.bookingId(), items);

        jdbc.sql("""
                        INSERT INTO flight_bookings (booking_id, offer_id, hold_id, provider, trip_type, cabin, fare_name,
                          refundable, checked_baggage_kg, cabin_baggage_kg, cancellation_fee_percent, adults, children,
                          infants, slices_json, pnr, demo)
                        VALUES (:id, :offer, :hold, 'DEMO', :tripType, 'ECONOMY', :fare, :refundable, :checked, 7, :fee,
                          :adults, :children, :infants, :slices, :pnr, TRUE)""")
                .param("id", DevIds.bytes(trip.bookingId())).param("offer", trip.offerId())
                .param("hold", DevIds.bytes(DevIds.of("hold", trip.key())))
                .param("tripType", trip.roundTrip() ? "ROUND_TRIP" : "ONE_WAY").param("fare", trip.fareName())
                .param("refundable", trip.flex()).param("checked", trip.checkedBaggageKg())
                .param("fee", trip.feePercent()).param("adults", trip.count("ADULT"))
                .param("children", trip.count("CHILD")).param("infants", trip.count("INFANT"))
                .param("slices", json.writeValueAsString(slices)).param("pnr", outcome.paid() ? trip.pnr() : null)
                .update();
        int number = 1;
        for (String type : List.of("ADULT", "CHILD", "INFANT")) {
            for (Traveller traveller : trip.people()) {
                if (!traveller.type().equals(type)) {
                    continue;
                }
                jdbc.sql("""
                                INSERT INTO booking_passengers (id, booking_id, passenger_no, passenger_type, first_name,
                                  last_name, date_of_birth, gender, nationality, ticket_number)
                                VALUES (:id, :booking, :no, :type, :first, :last, :dob, :gender, 'IN', :ticket)""")
                        .param("id", DevIds.bytes(DevIds.of("booking-passenger", trip.key() + ":" + number)))
                        .param("booking", DevIds.bytes(trip.bookingId())).param("no", number).param("type", type)
                        .param("first", traveller.firstName()).param("last", traveller.lastName())
                        .param("dob", Date.valueOf(traveller.dateOfBirth())).param("gender", traveller.gender())
                        .param("ticket", outcome.paid() ? trip.ticket(number) : null).update();
                number++;
            }
        }
        history(row, "Seats held at the quoted fare", "Confirming with the airline", "Confirmed by the airline");
        cancellationRows(row, false, now);
        publish(trip.bookingId());
        return true;
    }

    private static SliceView slice(Leg leg, LocalDate today) {
        var flight = leg.def();
        LocalDate date = leg.date(today);
        var from = DevScenario.airport(flight.origin());
        var to = DevScenario.airport(flight.destination());
        SegmentView segment = new SegmentView(flight.number(), flight.airlineCode(), flight.airlineName(),
                flight.origin(), flight.destination(), flight.departureLocal(date), flight.arrivalLocal(date),
                flight.durationMinutes());
        return new SliceView(flight.origin(), flight.destination(), from.city(), to.city(),
                flight.departureLocal(date), flight.arrivalLocal(date), flight.durationMinutes(), 0, List.of(segment));
    }

    // ------------------------------------------------------------------ shared rows

    /** What the booking row needs, whatever the type. */
    private static final class BookingRow {
        UUID id;
        String reference;
        Person user;
        String type;
        Outcome outcome;
        String title;
        String destination;
        LocalDate startDate;
        LocalDate endDate;
        BigDecimal base;
        BigDecimal tax;
        BigDecimal total;
        BigDecimal refunded;
        Instant booked;
        UUID paymentId;
        String source;
        String policy;
        Instant cancelUntil;
        Instant startsAt;
        Instant cancelledAt;
        Instant completedAt;
        String confirmedWord;
        boolean cancelledByHotel;
        String key;
        BigDecimal refundFee;
        String supplierReference;
    }

    private void insertBooking(BookingRow row, Instant now) {
        Outcome outcome = row.outcome;
        String status = switch (outcome) {
            case AWAITING_PAYMENT, PAYMENT_FAILED -> "PENDING_PAYMENT";
            case CONFIRMED, IN_HOUSE -> "CONFIRMED";
            case COMPLETED, NO_SHOW -> "COMPLETED";
            case CANCELLED_REFUNDED, CANCELLED_PARTIAL, CANCELLED_BY_HOTEL -> "REFUNDED";
        };
        String paymentStatus = switch (outcome) {
            case AWAITING_PAYMENT -> "UNPAID";
            case PAYMENT_FAILED -> "PAYMENT_FAILED";
            case CANCELLED_REFUNDED, CANCELLED_BY_HOTEL -> "REFUNDED";
            case CANCELLED_PARTIAL -> "PARTIALLY_REFUNDED";
            default -> "PAID";
        };
        Instant holdUntil = outcome.held() ? now.plus(DevScenario.PENDING_HOLD) : row.booked.plus(20, ChronoUnit.MINUTES);
        Instant updated = latest(row.booked, outcome.paid() ? row.booked.plus(12, ChronoUnit.MINUTES) : null,
                row.cancelledAt == null ? null : row.cancelledAt.plus(15, ChronoUnit.MINUTES),
                outcome == Outcome.COMPLETED || outcome == Outcome.NO_SHOW ? row.completedAt : null);
        jdbc.sql("""
                        INSERT INTO bookings (id, booking_reference, user_id, booking_type, status, payment_status, title,
                          destination, start_date, end_date, currency, base_amount, tax_amount, fee_amount, discount_amount,
                          total_amount, refunded_amount, contact_email, contact_phone, hold_expires_at, payment_deadline,
                          cancel_until, starts_at, paid_payment_id, inventory_source, cancellation_policy_snapshot,
                          idempotency_key, request_hash, confirmed_at, cancelled_at, created_at, updated_at, created_by,
                          updated_by, version)
                        VALUES (:id, :reference, :user, :type, :status, :paymentStatus, :title, :destination, :start, :end,
                          'INR', :base, :tax, 0, 0, :total, :refunded, :email, :phone, :holdUntil, :deadline, :cancelUntil,
                          :startsAt, :paymentId, :source, :policy, :idempotency, :hash, :confirmed, :cancelled, :booked,
                          :updated, :userText, :userText, 0)""")
                .param("id", DevIds.bytes(row.id)).param("reference", row.reference)
                .param("user", DevIds.bytes(row.user.id())).param("type", row.type).param("status", status)
                .param("paymentStatus", paymentStatus).param("title", row.title).param("destination", row.destination)
                .param("start", Date.valueOf(row.startDate)).param("end", Date.valueOf(row.endDate))
                .param("base", row.base).param("tax", row.tax).param("total", row.total)
                .param("refunded", row.refunded).param("email", row.user.email()).param("phone", row.user.phone())
                .param("holdUntil", Timestamp.from(holdUntil))
                .param("deadline", Timestamp.from(holdUntil.minus(5, ChronoUnit.MINUTES)))
                .param("cancelUntil", ts(row.cancelUntil)).param("startsAt", ts(row.startsAt))
                .param("paymentId", outcome.paid() ? DevIds.bytes(row.paymentId) : null)
                .param("source", row.source).param("policy", row.policy)
                .param("idempotency", "dev-seed-" + row.key)
                .param("hash", DevIds.hex(row.key, 32) + DevIds.hex(row.key + ":hash", 32))
                .param("confirmed", outcome.paid() ? Timestamp.from(row.booked.plus(12, ChronoUnit.MINUTES)) : null)
                .param("cancelled", ts(row.cancelledAt)).param("booked", Timestamp.from(row.booked))
                .param("updated", Timestamp.from(updated)).param("userText", row.user.id().toString()).update();
    }

    private void priceItems(UUID bookingId, List<String[]> items) {
        for (int i = 0; i < items.size(); i++) {
            jdbc.sql("""
                            INSERT INTO booking_price_items (booking_id, line_no, item_type, label, amount)
                            VALUES (:id, :line, :type, :label, :amount)""")
                    .param("id", DevIds.bytes(bookingId)).param("line", i).param("type", items.get(i)[0])
                    .param("label", items.get(i)[1]).param("amount", new BigDecimal(items.get(i)[2])).update();
        }
    }

    /** The booking timeline: every status the booking went through, with times in order. */
    private void history(BookingRow row, String held, String supplierPending, String confirmedText) {
        List<Object[]> steps = new ArrayList<>();   // from, to, reason, at, changedBy
        Instant t = row.booked;
        String system = BY;
        steps.add(new Object[] {null, "INITIATED", "Booking requested", t, row.user.id().toString()});
        t = t.plus(1, ChronoUnit.MINUTES);
        steps.add(new Object[] {"INITIATED", "PENDING_PAYMENT", held, t, system});
        if (row.outcome == Outcome.PAYMENT_FAILED) {
            steps.add(new Object[] {"PENDING_PAYMENT", "PENDING_PAYMENT",
                    "Payment failed: The demo payment was declined (Fail button). You can try again.",
                    t.plus(9, ChronoUnit.MINUTES), system});
        }
        if (row.outcome.paid()) {
            t = t.plus(9, ChronoUnit.MINUTES);
            steps.add(new Object[] {"PENDING_PAYMENT", "PAYMENT_SUCCESS", "Payment received", t, system});
            steps.add(new Object[] {"PAYMENT_SUCCESS", "SUPPLIER_PENDING", supplierPending, t, system});
            t = t.plus(2, ChronoUnit.MINUTES);
            steps.add(new Object[] {"SUPPLIER_PENDING", "CONFIRMED", confirmedText, t, system});
        }
        if (row.outcome == Outcome.COMPLETED || row.outcome == Outcome.NO_SHOW) {
            steps.add(new Object[] {"CONFIRMED", "COMPLETED",
                    row.outcome == Outcome.NO_SHOW ? "The guests did not arrive; the stay is closed" : "The trip is over",
                    row.completedAt, system});
        }
        if (row.outcome.cancelled()) {
            Instant c = row.cancelledAt;
            if (row.cancelledByHotel) {
                steps.add(new Object[] {"CONFIRMED", "CANCELLATION_PENDING", "Cancelled by the hotel (overbooking)", c,
                        system});
            } else {
                steps.add(new Object[] {"CONFIRMED", "CANCELLATION_PENDING", "Cancellation requested by the customer", c,
                        row.user.id().toString()});
            }
            steps.add(new Object[] {"CANCELLATION_PENDING", "CANCELLED", "Cancelled by " + row.confirmedWord,
                    c.plus(2, ChronoUnit.MINUTES), system});
            steps.add(new Object[] {"CANCELLED", "REFUND_PENDING", "Refund of " + row.refunded.toPlainString()
                    + " INR started", c.plus(3, ChronoUnit.MINUTES), system});
            steps.add(new Object[] {"REFUND_PENDING", "REFUNDED", "Refund completed", c.plus(10, ChronoUnit.MINUTES),
                    system});
        }
        for (int i = 0; i < steps.size(); i++) {
            Object[] step = steps.get(i);
            jdbc.sql("""
                            INSERT INTO booking_status_history (id, booking_id, from_status, to_status, reason, changed_by,
                              changed_at)
                            VALUES (:id, :booking, :from, :to, :reason, :by, :at)""")
                    .param("id", DevIds.bytes(DevIds.of("history", row.key + ":" + i)))
                    .param("booking", DevIds.bytes(row.id)).param("from", step[0]).param("to", step[1])
                    .param("reason", step[2]).param("by", step[4]).param("at", Timestamp.from((Instant) step[3])).update();
        }
    }

    /** The cancellation request (customer cancellations) and the refund the customer got. */
    private void cancellationRows(BookingRow row, boolean hotel, Instant now) {
        if (!row.outcome.cancelled()) {
            return;
        }
        UUID cancellationId = DevIds.of("cancellation", row.key);
        Instant at = row.cancelledAt;
        if (!row.cancelledByHotel) {
            jdbc.sql("""
                            INSERT INTO cancellations (id, booking_id, status, initiated_by, requested_by, reason, fee_waived,
                              currency, paid_amount, quoted_fee, quoted_refund, cancellation_fee, refund_amount, supplier_fee,
                              supplier_reference, idempotency_key, request_hash, attempts, last_sent_at, requested_at,
                              completed_at, version)
                            VALUES (:id, :booking, 'CONFIRMED', 'CUSTOMER', :user, :reason, FALSE, 'INR', :paid, :fee,
                              :refund, :fee, :refund, :supplierFee, :reference, :idempotency, :hash, 1, :at, :at, :done, 0)""")
                    .param("id", DevIds.bytes(cancellationId)).param("booking", DevIds.bytes(row.id))
                    .param("user", row.user.id().toString()).param("reason", "My plans changed")
                    .param("paid", row.total).param("fee", row.refundFee).param("refund", row.refunded)
                    .param("supplierFee", hotel ? null : row.refundFee).param("reference", row.supplierReference)
                    .param("idempotency", "dev-cancel-" + row.key)
                    .param("hash", DevIds.hex(row.key + ":cancel", 32) + DevIds.hex(row.key + ":cancel2", 32))
                    .param("at", Timestamp.from(at)).param("done", Timestamp.from(at.plus(2, ChronoUnit.MINUTES))).update();
        }
        jdbc.sql("""
                        INSERT INTO booking_refund_requests (id, booking_id, payment_id, cancellation_id, amount, currency,
                          reason, status, requested_at, completed_at, version, attempts, last_sent_at)
                        VALUES (:id, :booking, :payment, :cancellation, :amount, 'INR', 'CANCELLATION', 'COMPLETED', :at,
                          :done, 0, 1, :at)""")
                .param("id", DevIds.bytes(DevIds.of("refund-request", row.key))).param("booking", DevIds.bytes(row.id))
                .param("payment", DevIds.bytes(row.paymentId))
                .param("cancellation", row.cancelledByHotel ? null : DevIds.bytes(cancellationId))
                .param("amount", row.refunded).param("at", Timestamp.from(at.plus(3, ChronoUnit.MINUTES)))
                .param("done", Timestamp.from(at.plus(10, ChronoUnit.MINUTES))).update();
    }

    /** Internal notes of the support agent on two bookings (never shown to the customer). */
    private void notes(Instant now) {
        note("h08", "RESOLVED", "The hotel overbooked this stay. Full refund checked, the guest was offered a nearby "
                + "hotel and declined.", now.minus(1, ChronoUnit.DAYS));
        note("f05", "RESOLVED", "Explained the 25% fare cancellation fee of the flexible fare; taxes and charges were "
                + "refunded as expected.", now.minus(20, ChronoUnit.DAYS));
    }

    private void note(String key, String action, String text, Instant at) {
        UUID bookingId = DevIds.of("booking", key);
        if (!exists(bookingId)) {
            return;
        }
        jdbc.sql("""
                        INSERT IGNORE INTO booking_support_notes (id, booking_id, action, note, author_id, author_role,
                          created_at)
                        VALUES (:id, :booking, :action, :note, :author, 'SUPPORT_AGENT', :at)""")
                .param("id", DevIds.bytes(DevIds.of("support-note", key))).param("booking", DevIds.bytes(bookingId))
                .param("action", action).param("note", text).param("author", DevScenario.SUPPORT1.id().toString())
                .param("at", Timestamp.from(at)).update();
    }

    private void publish(UUID bookingId) {
        bookings.findById(bookingId).ifPresent(snapshots::publish);
    }

    private boolean exists(UUID id) {
        return jdbc.sql("SELECT COUNT(*) FROM bookings WHERE id = :id").param("id", DevIds.bytes(id))
                .query(Long.class).single() > 0;
    }

    private static Timestamp ts(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    private static Instant latest(Instant first, Instant... others) {
        Instant latest = first;
        for (Instant other : others) {
            if (other != null && other.isAfter(latest)) {
                latest = other;
            }
        }
        return latest;
    }
}
