package com.flighthotel.flight.integration.demo;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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

import com.flighthotel.common.dev.DevIds;
import com.flighthotel.common.dev.DevScenario;
import com.flighthotel.common.dev.DevScenario.FlightDef;
import com.flighthotel.common.dev.DevScenario.Leg;
import com.flighthotel.common.dev.DevScenario.Outcome;
import com.flighthotel.common.dev.DevScenario.Traveller;
import com.flighthotel.common.dev.DevScenario.Trip;
import com.flighthotel.common.dev.DevSeed;
import com.flighthotel.common.persistence.SecurityAuditorAware;
import com.flighthotel.flight.dto.FlightDtos.TripOffer;
import com.flighthotel.flight.dto.FlightDtos.TripSlice;
import com.flighthotel.flight.integration.FlightModel.Airline;
import com.flighthotel.flight.integration.FlightModel.Airport;
import com.flighthotel.flight.integration.FlightModel.Fare;
import com.flighthotel.flight.integration.FlightModel.OrderPassenger;
import com.flighthotel.flight.integration.FlightModel.Passengers;
import com.flighthotel.flight.integration.FlightModel.PriceLine;
import com.flighthotel.flight.integration.FlightModel.Segment;

import tools.jackson.databind.json.JsonMapper;

/**
 * <b>Development only</b> ({@code flight.dev-seed.enabled=true}, environment variable {@code DEV_SEED_ENABLED};
 * refuses to run in the {@code prod} profile). Adds the seven flights of the development timetable (flight numbers
 * 6E 7101, AI 9205, ... as non-stop schedules next to the generated DEMO timetable) and the airline-side records of
 * the development customers' flight bookings: held and issued supplier bookings with the trip as it was priced,
 * passengers, tickets, the DEMO airline's orders (also the cancelled one) and the seats they sold or hold.
 * <p>
 * Ids, references, PNRs, ticket numbers and amounts come from {@link DevScenario}, the same as the bookings in
 * booking-service. Rows are inserted directly, so no saga event is sent. Skipped where the id exists.
 */
@Component
@Order(20)
@ConditionalOnProperty(prefix = "flight.dev-seed", name = "enabled", havingValue = "true")
public class DevFlightSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevFlightSeeder.class);
    private static final String BY = SecurityAuditorAware.SYSTEM;
    private static final int ECONOMY_SEATS = 150;
    private static final Map<String, Integer> DISTANCE_KM = Map.of("del-bom", 1150, "bom-del", 1150, "blr-del", 1750,
            "del-blr", 1750, "bom-goi", 440, "hyd-maa", 520, "maa-blr", 290);

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final ReferenceData reference;
    private final JsonMapper json;
    private final Environment environment;
    private final Clock clock;

    public DevFlightSeeder(JdbcClient jdbc, TransactionTemplate transactions, ReferenceData reference, JsonMapper json,
            Environment environment, Clock clock) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.reference = reference;
        this.json = json;
        this.environment = environment;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!DevSeed.allowed(environment, log, "flight-service")) {
            return;
        }
        Instant now = clock.instant();
        LocalDate today = DevScenario.today(clock);
        transactions.executeWithoutResult(status -> DevScenario.FLIGHTS.forEach(this::schedule));
        int created = 0;
        for (Trip trip : DevScenario.TRIPS) {
            Boolean added = transactions.execute(status -> seedTrip(trip, now, today));
            created += Boolean.TRUE.equals(added) ? 1 : 0;
        }
        reference.refresh();
        log.info("Development flights ready: {} schedules, {} new supplier bookings", DevScenario.FLIGHTS.size(),
                created);
    }

    private void schedule(FlightDef flight) {
        jdbc.sql("""
                        INSERT IGNORE INTO demo_flight_schedules (id, airline_code, flight_number, origin, destination,
                          departure_local, duration_minutes, days_of_week, stops, via_airport, layover_minutes,
                          international, distance_km, cabins)
                        VALUES (:id, :airline, :number, :origin, :destination, :departure, :duration, '1234567', 0, NULL, 0,
                          FALSE, :km, 'ECONOMY')""")
                .param("id", DevIds.bytes(flight.scheduleId())).param("airline", flight.airlineCode())
                .param("number", flight.number()).param("origin", flight.origin())
                .param("destination", flight.destination()).param("departure", java.sql.Time.valueOf(flight.departure()))
                .param("duration", flight.durationMinutes()).param("km", DISTANCE_KM.get(flight.key())).update();
    }

    private boolean seedTrip(Trip trip, Instant now, LocalDate today) {
        if (jdbc.sql("SELECT COUNT(*) FROM flight_supplier_bookings WHERE booking_id = :id")
                .param("id", DevIds.bytes(trip.bookingId())).query(Long.class).single() > 0) {
            return false;
        }
        Outcome outcome = trip.outcome();
        var price = trip.price();
        Instant booked = trip.bookedAt(now);
        String status = outcome.held() ? "HELD" : outcome.cancelled() ? "CANCELLED" : "CONFIRMED";
        UUID cancellationId = DevIds.of("cancellation", trip.key());
        Instant cancelledAt = trip.cancelledAt(today);
        String orderId = trip.supplierOrderId();
        List<OrderPassenger> passengers = new ArrayList<>();
        int number = 1;
        for (String type : List.of("ADULT", "CHILD", "INFANT")) {
            for (Traveller traveller : trip.people()) {
                if (traveller.type().equals(type)) {
                    passengers.add(new OrderPassenger(number++, type, traveller.firstName(), traveller.lastName()));
                }
            }
        }
        jdbc.sql("""
                        INSERT INTO flight_supplier_bookings (id, booking_id, booking_reference, user_id, provider_code,
                          offer_id, idempotency_key, status, title, trip_json, passengers_json, adults, children, infants,
                          currency, total_amount, hold_expires_at, supplier_order_id, pnr, attempts, cancellation_id,
                          cancellation_reference, cancel_fee, cancel_refund, cancelled_at, created_at, updated_at,
                          created_by, updated_by, version)
                        VALUES (:id, :booking, :reference, :user, 'DEMO', :offer, :key, :status, :title, :trip, :passengers,
                          :adults, :children, :infants, 'INR', :total, :holdUntil, :orderId, :pnr, 0, :cancellationId,
                          :cancellationRef, :fee, :refund, :cancelledAt, :booked, :updated, :userText, :userText, 0)""")
                .param("id", DevIds.bytes(DevIds.of("supplier-booking", trip.key())))
                .param("booking", DevIds.bytes(trip.bookingId())).param("reference", trip.reference())
                .param("user", DevIds.bytes(trip.person().id())).param("offer", trip.offerId())
                .param("key", trip.bookingId().toString()).param("status", status).param("title", trip.title())
                .param("trip", json.writeValueAsString(tripOffer(trip, today, booked)))
                .param("passengers", json.writeValueAsString(passengers))
                .param("adults", trip.count("ADULT")).param("children", trip.count("CHILD"))
                .param("infants", trip.count("INFANT")).param("total", price.total())
                .param("holdUntil", Timestamp.from(outcome.held() ? now.plus(DevScenario.PENDING_HOLD)
                        : booked.plus(20, ChronoUnit.MINUTES)))
                .param("orderId", outcome.paid() ? orderId : null).param("pnr", outcome.paid() ? trip.pnr() : null)
                .param("cancellationId", outcome.cancelled() ? cancellationId.toString() : null)
                .param("cancellationRef", outcome.cancelled() ? DevIds.code("DX", trip.key(), 8) : null)
                .param("fee", outcome.cancelled() ? trip.cancellationFee() : null)
                .param("refund", outcome.cancelled() ? trip.refund() : null)
                .param("cancelledAt", cancelledAt == null ? null : Timestamp.from(cancelledAt))
                .param("booked", Timestamp.from(booked))
                .param("updated", Timestamp.from(cancelledAt != null ? cancelledAt : booked.plus(12, ChronoUnit.MINUTES)))
                .param("userText", trip.person().id().toString()).update();

        List<String> seatsText = new ArrayList<>();
        for (Leg leg : trip.legs()) {
            FlightDef flight = leg.def();
            LocalDate date = leg.date(today);
            jdbc.sql("""
                            INSERT INTO flight_hold_items (id, booking_id, schedule_id, flight_date, cabin, seats)
                            VALUES (:id, :booking, :schedule, :date, 'ECONOMY', :seats)""")
                    .param("id", DevIds.bytes(DevIds.of("hold-item", trip.key() + ":" + flight.key())))
                    .param("booking", DevIds.bytes(trip.bookingId())).param("schedule", DevIds.bytes(flight.scheduleId()))
                    .param("date", Date.valueOf(date)).param("seats", trip.seats()).update();
            seatsText.add(flight.scheduleId() + "|" + date + "|ECONOMY|" + trip.seats());
            // The airline's seat count: sold for issued tickets, held for the waiting ones, nothing once cancelled.
            int sold = outcome.paid() && !outcome.cancelled() ? trip.seats() : 0;
            int held = outcome.held() ? trip.seats() : 0;
            jdbc.sql("""
                            INSERT INTO demo_seat_inventory (id, schedule_id, flight_date, cabin, seats_total, seats_held,
                              seats_sold, version)
                            VALUES (:id, :schedule, :date, 'ECONOMY', :total, :held, :sold, 0)
                            ON DUPLICATE KEY UPDATE seats_held = seats_held + VALUES(seats_held),
                              seats_sold = seats_sold + VALUES(seats_sold)""")
                    .param("id", DevIds.bytes(DevIds.of("seat-inventory", flight.key() + ":" + date)))
                    .param("schedule", DevIds.bytes(flight.scheduleId())).param("date", Date.valueOf(date))
                    .param("total", ECONOMY_SEATS).param("held", held).param("sold", sold).update();
        }
        if (outcome.paid()) {
            StringBuilder tickets = new StringBuilder();
            for (int i = 1; i <= passengers.size(); i++) {
                jdbc.sql("""
                                INSERT INTO flight_supplier_tickets (id, booking_id, passenger_no, ticket_number)
                                VALUES (:id, :booking, :no, :ticket)""")
                        .param("id", DevIds.bytes(DevIds.of("supplier-ticket", trip.key() + ":" + i)))
                        .param("booking", DevIds.bytes(trip.bookingId())).param("no", i).param("ticket", trip.ticket(i))
                        .update();
                tickets.append(i > 1 ? "," : "").append(i).append(':').append(trip.ticket(i));
            }
            jdbc.sql("""
                            INSERT INTO demo_orders (supplier_order_id, idempotency_key, pnr, status, tickets, created_at,
                              seats, currency, fare_amount, total_amount, cancel_fee_percent, cancel_behaviour, cancel_key,
                              cancel_ref, penalty, refund_amount, cancelled_at)
                            VALUES (:order, :key, :pnr, :status, :tickets, :created, :seats, 'INR', :fare, :total, :percent,
                              'NORMAL', :cancelKey, :cancelRef, :penalty, :refund, :cancelledAt)""")
                    .param("order", orderId).param("key", trip.bookingId().toString()).param("pnr", trip.pnr())
                    .param("status", outcome.cancelled() ? "CANCELLED" : "ISSUED").param("tickets", tickets.toString())
                    .param("created", Timestamp.from(booked.plus(12, ChronoUnit.MINUTES)))
                    .param("seats", String.join(";", seatsText)).param("fare", price.subtotal())
                    .param("total", price.total()).param("percent", trip.feePercent())
                    .param("cancelKey", outcome.cancelled() ? cancellationId.toString() : null)
                    .param("cancelRef", outcome.cancelled() ? DevIds.code("DX", trip.key(), 8) : null)
                    .param("penalty", outcome.cancelled() ? trip.cancellationFee() : null)
                    .param("refund", outcome.cancelled() ? trip.refund() : null)
                    .param("cancelledAt", cancelledAt == null ? null : Timestamp.from(cancelledAt)).update();
        }
        return true;
    }

    /** The trip as flight-service held and priced it (the same structure the real hold stores). */
    private TripOffer tripOffer(Trip trip, LocalDate today, Instant booked) {
        List<TripSlice> slices = new ArrayList<>();
        for (Leg leg : trip.legs()) {
            FlightDef flight = leg.def();
            LocalDate date = leg.date(today);
            var from = DevScenario.airport(flight.origin());
            var to = DevScenario.airport(flight.destination());
            Segment segment = new Segment(flight.number(), flight.airlineCode(), flight.airlineName(), flight.origin(),
                    flight.destination(), flight.departureLocal(date), flight.arrivalLocal(date),
                    flight.durationMinutes());
            Fare fare = new Fare(trip.fareName(), trip.fareType(), trip.flex(), trip.checkedBaggageKg(), 7,
                    trip.feePercent(), trip.fareCancellationPolicy());
            slices.add(new TripSlice(new Airport(from.code(), from.name(), from.city(), "IN"),
                    new Airport(to.code(), to.name(), to.city(), "IN"),
                    new Airline(flight.airlineCode(), flight.airlineName()), flight.number(),
                    flight.departureLocal(date), flight.arrivalLocal(date), flight.durationMinutes(), 0, null,
                    List.of(segment), fare));
        }
        var price = trip.price();
        return new TripOffer(trip.offerId(), booked.plus(20, ChronoUnit.MINUTES),
                trip.roundTrip() ? "ROUND_TRIP" : "ONE_WAY", "ECONOMY", "DEMO", true, trip.title(), false,
                new Passengers(trip.count("ADULT"), trip.count("CHILD"), trip.count("INFANT")), slices, trip.flex(),
                trip.checkedBaggageKg(), 7, trip.cancellationPolicy(),
                price.lines().stream().map(l -> new PriceLine(l.label(), l.amount())).toList(), price.subtotal(),
                price.taxes(), price.total(), "INR", false, null);
    }
}
