package com.flighthotel.flight.integration.demo;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.flight.config.FlightProperties;
import com.flighthotel.flight.integration.FlightModel.Fare;
import com.flighthotel.flight.integration.FlightModel.FlightOption;
import com.flighthotel.flight.integration.FlightModel.OptionRef;
import com.flighthotel.flight.integration.FlightModel.OrderPassenger;
import com.flighthotel.flight.integration.FlightModel.OrderRequest;
import com.flighthotel.flight.integration.FlightModel.Passengers;
import com.flighthotel.flight.integration.FlightModel.Price;
import com.flighthotel.flight.integration.FlightModel.PriceLine;
import com.flighthotel.flight.integration.FlightModel.ProviderInfo;
import com.flighthotel.flight.integration.FlightModel.Quote;
import com.flighthotel.flight.integration.FlightModel.SearchCriteria;
import com.flighthotel.flight.integration.FlightModel.SeatRequest;
import com.flighthotel.flight.integration.FlightModel.Segment;
import com.flighthotel.flight.integration.FlightModel.SoldOutException;
import com.flighthotel.flight.integration.FlightModel.StoredOption;
import com.flighthotel.flight.integration.FlightModel.SupplierCancellation;
import com.flighthotel.flight.integration.FlightModel.SupplierException;
import com.flighthotel.flight.integration.FlightModel.SupplierOrder;
import com.flighthotel.flight.integration.FlightModel.SupplierRejectedException;
import com.flighthotel.flight.integration.FlightModel.SupplierTimeoutException;
import com.flighthotel.flight.integration.FlightModel.Ticket;
import com.flighthotel.flight.integration.FlightProviders.FlightBookingProvider;
import com.flighthotel.flight.integration.FlightProviders.FlightSearchProvider;
import com.flighthotel.flight.integration.demo.ReferenceData.FareFamily;
import com.flighthotel.flight.integration.demo.ReferenceData.Schedule;

/**
 * The DEMO provider (SUPPLIER_INTEGRATION.md section 4): a small airline system inside flight-service. Prices follow
 * distance, cabin, fare family, days before departure and how full the flight is; seats are held and sold atomically;
 * orders are idempotent per key.
 * <p>
 * Simulation switches for testing every failure path: a passenger whose last name is {@code REJECT} makes the order
 * fail, {@code TIMEOUT} loses the answer although the order was issued (found later by reconciliation) and
 * {@code TIMEOUTLOST} loses the answer and the order. {@code flight.demo.failure-rate} and {@code timeout-rate}
 * (default 0) do the same at random.
 * <p>
 * Cancellations (Phase 7): allowed until 4 hours before the first departure, at the fare family's fee (a share of the
 * fare; taxes and charges are refunded). Last names for testing: {@code NOCANCEL} (the airline refuses),
 * {@code CANCELTIMEOUT} (cancelled, but the answer is lost: found by reconciliation) and {@code CANCELLOST} (no answer
 * and nothing cancelled).
 */
@Component
public class DemoFlightProvider implements FlightSearchProvider, FlightBookingProvider {

    public static final String CODE = "DEMO";
    private static final Logger log = LoggerFactory.getLogger(DemoFlightProvider.class);
    private static final DateTimeFormatter LOCAL = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm");
    private static final Map<String, Integer> SEATS = Map.of("ECONOMY", 150, "PREMIUM_ECONOMY", 24, "BUSINESS", 16,
            "FIRST", 8);
    private static final char[] PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();
    /** No online cancellation in the last hours before departure. */
    public static final Duration CANCEL_CUTOFF = Duration.ofHours(4);

    private final JdbcClient jdbc;
    private final ReferenceData reference;
    private final FlightProperties properties;
    private final Clock clock;

    public DemoFlightProvider(JdbcClient jdbc, ReferenceData reference, FlightProperties properties, Clock clock) {
        this.jdbc = jdbc;
        this.reference = reference;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public ProviderInfo info() {
        return new ProviderInfo(CODE, "Demo airline system", true, true);
    }

    // ================================================================== search and prices

    @Override
    public List<StoredOption> search(SearchCriteria criteria) {
        List<Schedule> schedules = reference.schedules(criteria.origin(), criteria.destination()).stream()
                .filter(s -> s.daysOfWeek().contains(String.valueOf(criteria.date().getDayOfWeek().getValue())))
                .filter(s -> s.cabins().contains(criteria.cabin()))
                .toList();
        Map<String, Seats> seats = seatsOf(schedules.stream().map(Schedule::id).toList(), criteria.date(),
                criteria.cabin());
        List<StoredOption> options = new ArrayList<>();
        for (Schedule schedule : schedules) {
            Seats row = seats.getOrDefault(schedule.id(), Seats.empty(totalSeats(criteria.cabin())));
            if (row.left() < criteria.passengers().seats()) {
                continue;
            }
            for (String type : List.of("NON_REFUNDABLE", "REFUNDABLE")) {
                OptionRef ref = new OptionRef(schedule.id(), criteria.date(), criteria.cabin(), type);
                options.add(new StoredOption(option(schedule, ref, criteria.passengers(), row), ref,
                        criteria.passengers()));
            }
        }
        return options;
    }

    @Override
    public Quote quote(OptionRef ref, Passengers passengers) {
        Schedule schedule = reference.schedule(ref.scheduleId());
        if (schedule == null) {
            throw new SoldOutException();
        }
        Seats row = seatsOf(List.of(schedule.id()), ref.date(), ref.cabin())
                .getOrDefault(schedule.id(), Seats.empty(totalSeats(ref.cabin())));
        if (row.left() < passengers.seats()) {
            throw new SoldOutException();
        }
        return new Quote(price(schedule, ref, passengers, row), row.left());
    }

    private FlightOption option(Schedule schedule, OptionRef ref, Passengers passengers, Seats row) {
        FareFamily family = reference.fare(ref.cabin(), ref.fareType());
        Price price = price(schedule, ref, passengers, row);
        LocalDateTime departure = ref.date().atTime(schedule.departureLocal());
        List<Segment> segments = segments(schedule, departure);
        Segment last = segments.getLast();
        return new FlightOption(UuidV7.generate().toString(), CODE, true, reference.airline(schedule.airlineCode()),
                schedule.flightNumber(), reference.airport(schedule.origin()), reference.airport(schedule.destination()),
                departure.format(LOCAL), last.arrivalLocal(), schedule.durationMinutes(), schedule.stops(),
                schedule.viaAirport(), segments, ref.cabin(), fare(family), Math.min(row.left(), 9),
                price.perAdult(), price.total(), "INR", null);
    }

    static Fare fare(FareFamily family) {
        boolean refundable = "REFUNDABLE".equals(family.type());
        String policy = refundable
                ? "Cancel up to 4 hours before departure for a fee of " + family.cancelFeePercent()
                        + "% of the fare. Taxes and airline charges are refunded."
                : "Non-refundable: the fare is not refunded if you cancel. Taxes and airline charges may be refunded.";
        return new Fare(family.name(), family.type(), refundable, family.checkedBaggageKg(), family.cabinBaggageKg(),
                family.cancelFeePercent(), policy);
    }

    private List<Segment> segments(Schedule schedule, LocalDateTime departure) {
        String airline = reference.airline(schedule.airlineCode()).name();
        ZoneId originZone = ZoneId.of(reference.timezone(schedule.origin()));
        var departureInstant = departure.atZone(originZone);
        if (schedule.stops() == 0 || schedule.viaAirport() == null) {
            var arrival = departureInstant.plusMinutes(schedule.durationMinutes())
                    .withZoneSameInstant(ZoneId.of(reference.timezone(schedule.destination())));
            return List.of(new Segment(schedule.flightNumber(), schedule.airlineCode(), airline, schedule.origin(),
                    schedule.destination(), departure.format(LOCAL), arrival.toLocalDateTime().format(LOCAL),
                    schedule.durationMinutes()));
        }
        int flying = schedule.durationMinutes() - schedule.layoverMinutes();
        int first = Math.round(flying * 0.55f);
        int second = flying - first;
        ZoneId viaZone = ZoneId.of(reference.timezone(schedule.viaAirport()));
        var arriveVia = departureInstant.plusMinutes(first).withZoneSameInstant(viaZone);
        var departVia = arriveVia.plusMinutes(schedule.layoverMinutes());
        var arrival = departVia.plusMinutes(second)
                .withZoneSameInstant(ZoneId.of(reference.timezone(schedule.destination())));
        return List.of(
                new Segment(schedule.flightNumber(), schedule.airlineCode(), airline, schedule.origin(),
                        schedule.viaAirport(), departure.format(LOCAL), arriveVia.toLocalDateTime().format(LOCAL),
                        first),
                new Segment(schedule.flightNumber(), schedule.airlineCode(), airline, schedule.viaAirport(),
                        schedule.destination(), departVia.toLocalDateTime().format(LOCAL),
                        arrival.toLocalDateTime().format(LOCAL), second));
    }

    /** Base fare by distance, then cabin/fare family, days before departure and how full the flight is. */
    Price price(Schedule schedule, OptionRef ref, Passengers passengers, Seats row) {
        FareFamily family = reference.fare(ref.cabin(), ref.fareType());
        double base = schedule.international() ? Math.max(9000, 4.2 * schedule.distanceKm() + 3000)
                : Math.max(2200, 3.2 * schedule.distanceKm() + 1200);
        long days = ChronoUnit.DAYS.between(LocalDate.now(clock.withZone(ZoneId.of("Asia/Kolkata"))), ref.date());
        double dayFactor = days >= 60 ? 0.85 : days >= 30 ? 0.95 : days >= 14 ? 1.05 : days >= 7 ? 1.2
                : days >= 3 ? 1.4 : 1.7;
        double fill = row.total() == 0 ? 0 : (double) (row.held() + row.sold()) / row.total();
        double loadFactor = fill < 0.4 ? 1.0 : fill < 0.7 ? 1.12 : fill < 0.9 ? 1.3 : 1.55;
        double stopsFactor = schedule.stops() > 0 ? 0.92 : 1.0;
        BigDecimal adult = rupees(base * family.multiplier().doubleValue() * dayFactor * loadFactor * stopsFactor);
        BigDecimal child = rupees(adult.doubleValue() * 0.75);
        BigDecimal infant = rupees(adult.doubleValue() * 0.10);

        List<PriceLine> lines = new ArrayList<>();
        BigDecimal fares = BigDecimal.ZERO;
        fares = addFare(lines, fares, "adult", passengers.adults(), adult);
        fares = addFare(lines, fares, "child", passengers.children(), child);
        fares = addFare(lines, fares, "infant", passengers.infants(), infant);
        BigDecimal fees = BigDecimal.valueOf(schedule.international() ? 1600 : 450)
                .multiply(BigDecimal.valueOf(passengers.seats())).setScale(2);
        int gstPercent = "ECONOMY".equals(ref.cabin()) || "PREMIUM_ECONOMY".equals(ref.cabin()) ? 5 : 12;
        BigDecimal gst = fares.multiply(BigDecimal.valueOf(gstPercent)).divide(BigDecimal.valueOf(100), 2,
                RoundingMode.HALF_UP);
        lines.add(new PriceLine("Fuel and airport charges", fees));
        lines.add(new PriceLine("GST " + gstPercent + "%", gst));
        BigDecimal taxes = fees.add(gst);
        BigDecimal perAdult = adult.add(BigDecimal.valueOf(schedule.international() ? 1600 : 450))
                .add(adult.multiply(BigDecimal.valueOf(gstPercent)).divide(BigDecimal.valueOf(100), 2,
                        RoundingMode.HALF_UP));
        return new Price(lines, fares, taxes, fares.add(taxes), perAdult);
    }

    private static BigDecimal addFare(List<PriceLine> lines, BigDecimal sum, String type, int count, BigDecimal each) {
        if (count == 0) {
            return sum;
        }
        BigDecimal amount = each.multiply(BigDecimal.valueOf(count));
        lines.add(new PriceLine("Fare · " + count + " " + type + (count == 1 ? "" : "s"), amount));
        return sum.add(amount);
    }

    private static BigDecimal rupees(double amount) {
        return BigDecimal.valueOf(Math.round(amount / 10.0) * 10L).setScale(2);
    }

    // ================================================================== seats

    record Seats(int total, int held, int sold) {

        static Seats empty(int total) {
            return new Seats(total, 0, 0);
        }

        int left() {
            return total - held - sold;
        }
    }

    private static int totalSeats(String cabin) {
        return SEATS.getOrDefault(cabin, 100);
    }

    private Map<String, Seats> seatsOf(List<String> scheduleIds, LocalDate date, String cabin) {
        Map<String, Seats> result = new HashMap<>();
        for (String id : scheduleIds) {
            jdbc.sql("SELECT seats_total, seats_held, seats_sold FROM demo_seat_inventory "
                            + "WHERE schedule_id = UUID_TO_BIN(:id) AND flight_date = :date AND cabin = :cabin")
                    .param("id", id).param("date", Date.valueOf(date)).param("cabin", cabin)
                    .query((rs, i) -> new Seats(rs.getInt(1), rs.getInt(2), rs.getInt(3))).optional()
                    .ifPresent(row -> result.put(id, row));
        }
        return result;
    }

    private void ensureRow(SeatRequest seat) {
        jdbc.sql("INSERT IGNORE INTO demo_seat_inventory (id, schedule_id, flight_date, cabin, seats_total) "
                        + "VALUES (UUID_TO_BIN(:id), UUID_TO_BIN(:schedule), :date, :cabin, :total)")
                .param("id", UuidV7.generate().toString()).param("schedule", seat.scheduleId())
                .param("date", Date.valueOf(seat.date())).param("cabin", seat.cabin())
                .param("total", totalSeats(seat.cabin())).update();
    }

    @Override
    public boolean hold(List<SeatRequest> seats) {
        List<SeatRequest> done = new ArrayList<>();
        for (SeatRequest seat : seats) {
            ensureRow(seat);
            int updated = jdbc.sql("UPDATE demo_seat_inventory SET seats_held = seats_held + :n, version = version + 1 "
                            + "WHERE schedule_id = UUID_TO_BIN(:id) AND flight_date = :date AND cabin = :cabin "
                            + "AND seats_total - seats_held - seats_sold >= :n")
                    .param("n", seat.seats()).param("id", seat.scheduleId()).param("date", Date.valueOf(seat.date()))
                    .param("cabin", seat.cabin()).update();
            if (updated == 0) {
                release(done);   // all or nothing
                return false;
            }
            done.add(seat);
        }
        return true;
    }

    @Override
    public void release(List<SeatRequest> seats) {
        for (SeatRequest seat : seats) {
            jdbc.sql("UPDATE demo_seat_inventory SET seats_held = seats_held - :n, version = version + 1 "
                            + "WHERE schedule_id = UUID_TO_BIN(:id) AND flight_date = :date AND cabin = :cabin "
                            + "AND seats_held >= :n")
                    .param("n", seat.seats()).param("id", seat.scheduleId()).param("date", Date.valueOf(seat.date()))
                    .param("cabin", seat.cabin()).update();
        }
    }

    private void sell(List<SeatRequest> seats) {
        for (SeatRequest seat : seats) {
            jdbc.sql("UPDATE demo_seat_inventory SET seats_held = seats_held - :n, seats_sold = seats_sold + :n, "
                            + "version = version + 1 WHERE schedule_id = UUID_TO_BIN(:id) AND flight_date = :date "
                            + "AND cabin = :cabin AND seats_held >= :n")
                    .param("n", seat.seats()).param("id", seat.scheduleId()).param("date", Date.valueOf(seat.date()))
                    .param("cabin", seat.cabin()).update();
        }
    }

    // ================================================================== orders

    @Override
    public SupplierOrder createOrder(OrderRequest request) {
        Optional<SupplierOrder> existing = findOrder(request.idempotencyKey());
        if (existing.isPresent()) {
            return existing.get();   // idempotent: the same key never creates a second order
        }
        Behaviour behaviour = behaviour(request.passengers());
        switch (behaviour) {
            case REJECT -> throw new SupplierRejectedException("The airline rejected this booking.");
            case TIMEOUT_LOST -> throw new SupplierTimeoutException("The airline did not answer in time.");
            default -> {
                // issue below
            }
        }
        sell(request.seats());
        String suffix = String.valueOf(ThreadLocalRandom.current().nextLong(1_000_000_000L, 10_000_000_000L));
        String orderId = "DO" + suffix;
        String pnr = pnr();
        List<Ticket> tickets = request.passengers().stream()
                .map(p -> new Ticket(p.passengerNo(), "098" + ThreadLocalRandom.current()
                        .nextLong(1_000_000_000L, 10_000_000_000L)))
                .toList();
        jdbc.sql("INSERT INTO demo_orders (supplier_order_id, idempotency_key, pnr, status, tickets, created_at, seats, "
                        + "currency, fare_amount, total_amount, cancel_fee_percent, cancel_behaviour) "
                        + "VALUES (:id, :key, :pnr, 'ISSUED', :tickets, UTC_TIMESTAMP(6), :seats, :currency, :fare, "
                        + ":total, :fee, :cancelBehaviour)")
                .param("id", orderId).param("key", request.idempotencyKey()).param("pnr", pnr)
                .param("tickets", tickets.stream().map(t -> t.passengerNo() + ":" + t.ticketNumber())
                        .reduce((a, b) -> a + "," + b).orElse(""))
                .param("seats", seatsText(request.seats()))
                .param("currency", request.pricing().currency())
                .param("fare", request.pricing().fareAmount())
                .param("total", request.pricing().totalAmount())
                .param("fee", request.pricing().cancelFeePercent())
                .param("cancelBehaviour", cancelBehaviour(request.passengers()).name())
                .update();
        SupplierOrder order = new SupplierOrder(orderId, pnr, tickets);
        if (behaviour == Behaviour.TIMEOUT_ISSUED) {
            log.info("DEMO supplier issued the order but the answer is lost key={}", request.idempotencyKey());
            throw new SupplierTimeoutException("The airline did not answer in time.");
        }
        return order;
    }

    @Override
    public Optional<SupplierOrder> findOrder(String idempotencyKey) {
        return jdbc.sql("SELECT supplier_order_id, pnr, tickets FROM demo_orders WHERE idempotency_key = :key")
                .param("key", idempotencyKey).query((rs, i) -> {
                    List<Ticket> tickets = new ArrayList<>();
                    for (String entry : rs.getString(3).split(",")) {
                        String[] parts = entry.split(":");
                        tickets.add(new Ticket(Integer.parseInt(parts[0]), parts[1]));
                    }
                    return new SupplierOrder(rs.getString(1), rs.getString(2), tickets);
                }).optional();
    }

    // ================================================================== cancellations

    @Override
    public SupplierCancellation cancelOrder(String supplierOrderId, String idempotencyKey) {
        DemoOrder order = order(supplierOrderId).orElseThrow(() -> new SupplierRejectedException("NOT_CANCELLABLE",
                "The airline has no booking with this reference."));
        if (order.cancellation() != null) {
            return order.cancellation();   // idempotent: cancelling twice changes nothing
        }
        if (order.seats() == null || order.fareAmount() == null) {
            throw new SupplierRejectedException("NOT_CANCELLABLE", "This booking cannot be cancelled online.");
        }
        switch (order.cancelBehaviour()) {
            case REJECT -> throw new SupplierRejectedException("NOT_ALLOWED",
                    "The airline does not allow this booking to be cancelled online.");
            case LOST -> throw new SupplierTimeoutException("The airline did not answer in time.");
            default -> {
                // cancel below
            }
        }
        Instant now = clock.instant();
        List<SeatRequest> seats = seatsOf(order.seats());
        if (!now.isBefore(firstDeparture(seats).minus(CANCEL_CUTOFF))) {
            throw new SupplierRejectedException("TOO_LATE",
                    "Flights can only be cancelled online up to 4 hours before departure.");
        }
        BigDecimal penalty = order.fareAmount().multiply(BigDecimal.valueOf(order.cancelFeePercent()))
                .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP).min(order.totalAmount());
        BigDecimal refund = order.totalAmount().subtract(penalty);
        String reference = cancellationReference();
        int changed = jdbc.sql("UPDATE demo_orders SET status = 'CANCELLED', cancel_key = :key, cancel_ref = :ref, "
                        + "penalty = :penalty, refund_amount = :refund, cancelled_at = UTC_TIMESTAMP(6) "
                        + "WHERE supplier_order_id = :id AND status = 'ISSUED'")
                .param("key", idempotencyKey).param("ref", reference).param("penalty", penalty)
                .param("refund", refund).param("id", supplierOrderId).update();
        if (changed != 1) {
            throw new SupplierRejectedException("NOT_CANCELLABLE", "This booking is no longer active at the airline.");
        }
        unsell(seats);
        log.info("DEMO airline cancelled order={} penalty={} refund={}", supplierOrderId, penalty, refund);
        SupplierCancellation cancellation = findCancellation(supplierOrderId).orElseThrow();
        if (order.cancelBehaviour() == CancelBehaviour.TIMEOUT) {
            log.info("DEMO airline cancelled the order but the answer is lost order={}", supplierOrderId);
            throw new SupplierTimeoutException("The airline did not answer in time.");
        }
        return cancellation;
    }

    @Override
    public Optional<SupplierCancellation> findCancellation(String supplierOrderId) {
        return order(supplierOrderId).map(DemoOrder::cancellation);
    }

    private Optional<DemoOrder> order(String supplierOrderId) {
        return jdbc.sql("SELECT status, seats, currency, fare_amount, total_amount, cancel_fee_percent, "
                        + "cancel_behaviour, cancel_ref, penalty, refund_amount, cancelled_at FROM demo_orders "
                        + "WHERE supplier_order_id = :id")
                .param("id", supplierOrderId)
                .query((rs, i) -> {
                    SupplierCancellation cancellation = "CANCELLED".equals(rs.getString("status"))
                            ? new SupplierCancellation(rs.getString("cancel_ref"), rs.getBigDecimal("penalty"),
                                    rs.getBigDecimal("refund_amount"), rs.getString("currency"),
                                    rs.getObject("cancelled_at", LocalDateTime.class).toInstant(ZoneOffset.UTC))
                            : null;
                    int fee = rs.getInt("cancel_fee_percent");
                    boolean noFee = rs.wasNull();
                    return new DemoOrder(rs.getString("seats"), rs.getString("currency"),
                            rs.getBigDecimal("fare_amount"), rs.getBigDecimal("total_amount"), noFee ? 100 : fee,
                            CancelBehaviour.valueOf(rs.getString("cancel_behaviour")), cancellation);
                })
                .optional();
    }

    /** The first departure of the order, in the origin airport's time zone. */
    private Instant firstDeparture(List<SeatRequest> seats) {
        return seats.stream().map(seat -> {
            Schedule schedule = reference.schedule(seat.scheduleId());
            return seat.date().atTime(schedule.departureLocal())
                    .atZone(ZoneId.of(reference.timezone(schedule.origin()))).toInstant();
        }).min(Instant::compareTo).orElseThrow();
    }

    private void unsell(List<SeatRequest> seats) {
        for (SeatRequest seat : seats) {
            jdbc.sql("UPDATE demo_seat_inventory SET seats_sold = seats_sold - :n, version = version + 1 "
                            + "WHERE schedule_id = UUID_TO_BIN(:id) AND flight_date = :date AND cabin = :cabin "
                            + "AND seats_sold >= :n")
                    .param("n", seat.seats()).param("id", seat.scheduleId()).param("date", Date.valueOf(seat.date()))
                    .param("cabin", seat.cabin()).update();
        }
    }

    /** {@code scheduleId|2026-11-20|ECONOMY|2;...} */
    private static String seatsText(List<SeatRequest> seats) {
        return seats.stream().map(s -> s.scheduleId() + "|" + s.date() + "|" + s.cabin() + "|" + s.seats())
                .reduce((a, b) -> a + ";" + b).orElse("");
    }

    private static List<SeatRequest> seatsOf(String text) {
        List<SeatRequest> seats = new ArrayList<>();
        for (String entry : text.split(";")) {
            String[] parts = entry.split("\\|");
            seats.add(new SeatRequest(parts[0], LocalDate.parse(parts[1]), parts[2], Integer.parseInt(parts[3])));
        }
        return seats;
    }

    private static String cancellationReference() {
        StringBuilder text = new StringBuilder("DX");
        for (int i = 0; i < 8; i++) {
            text.append(PNR_ALPHABET[ThreadLocalRandom.current().nextInt(PNR_ALPHABET.length)]);
        }
        return text.toString();
    }

    private enum CancelBehaviour { NORMAL, REJECT, TIMEOUT, LOST }

    private static CancelBehaviour cancelBehaviour(List<OrderPassenger> passengers) {
        for (OrderPassenger passenger : passengers) {
            String last = passenger.lastName() == null ? "" : passenger.lastName().strip().toUpperCase();
            switch (last) {
                case "NOCANCEL" -> {
                    return CancelBehaviour.REJECT;
                }
                case "CANCELTIMEOUT" -> {
                    return CancelBehaviour.TIMEOUT;
                }
                case "CANCELLOST" -> {
                    return CancelBehaviour.LOST;
                }
                default -> {
                    // normal passenger
                }
            }
        }
        return CancelBehaviour.NORMAL;
    }

    private record DemoOrder(String seats, String currency, BigDecimal fareAmount, BigDecimal totalAmount,
            int cancelFeePercent, CancelBehaviour cancelBehaviour, SupplierCancellation cancellation) {
    }

    @Override
    public void checkHealth() {
        Integer airports = jdbc.sql("SELECT COUNT(*) FROM airports").query(Integer.class).single();
        if (airports == null || airports == 0) {
            throw new SupplierException("SUPPLIER_UNAVAILABLE", "The demo airline system has no data.");
        }
    }

    private enum Behaviour { NORMAL, REJECT, TIMEOUT_ISSUED, TIMEOUT_LOST }

    private Behaviour behaviour(List<OrderPassenger> passengers) {
        for (OrderPassenger passenger : passengers) {
            String last = passenger.lastName() == null ? "" : passenger.lastName().strip().toUpperCase();
            switch (last) {
                case "REJECT" -> {
                    return Behaviour.REJECT;
                }
                case "TIMEOUT" -> {
                    return Behaviour.TIMEOUT_ISSUED;
                }
                case "TIMEOUTLOST" -> {
                    return Behaviour.TIMEOUT_LOST;
                }
                default -> {
                    // normal passenger
                }
            }
        }
        double roll = ThreadLocalRandom.current().nextDouble();
        FlightProperties.Demo demo = properties.demo();
        if (roll < demo.failureRate()) {
            return Behaviour.REJECT;
        }
        if (roll < demo.failureRate() + demo.timeoutRate()) {
            return Behaviour.TIMEOUT_ISSUED;
        }
        return Behaviour.NORMAL;
    }

    private static String pnr() {
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < 6; i++) {
            text.append(PNR_ALPHABET[ThreadLocalRandom.current().nextInt(PNR_ALPHABET.length)]);
        }
        return text.toString();
    }
}
