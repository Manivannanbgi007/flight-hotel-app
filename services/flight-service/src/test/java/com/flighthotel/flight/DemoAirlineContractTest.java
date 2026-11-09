package com.flighthotel.flight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.sql.Date;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import com.flighthotel.flight.integration.FlightModel.OptionRef;
import com.flighthotel.flight.integration.FlightModel.OrderPassenger;
import com.flighthotel.flight.integration.FlightModel.OrderPricing;
import com.flighthotel.flight.integration.FlightModel.OrderRequest;
import com.flighthotel.flight.integration.FlightModel.Passengers;
import com.flighthotel.flight.integration.FlightModel.SearchCriteria;
import com.flighthotel.flight.integration.FlightModel.SeatRequest;
import com.flighthotel.flight.integration.FlightModel.SupplierCancellation;
import com.flighthotel.flight.integration.FlightModel.SupplierOrder;
import com.flighthotel.flight.integration.FlightModel.SupplierRejectedException;
import com.flighthotel.flight.integration.FlightModel.SupplierTimeoutException;
import com.flighthotel.flight.integration.demo.DemoFlightProvider;

/**
 * The flight supplier contract of SUPPLIER_INTEGRATION.md section 2, checked directly against the DEMO airline (the
 * sandbox every real adapter must behave like): holds are all or nothing, an order is created at most once per
 * idempotency key even when the answer is lost, and cancelling twice gives the seats back once. The saga's handling of
 * these outcomes is tested in {@link FlightBookingSagaIntegrationTest} and {@link FlightCancellationIntegrationTest}.
 */
class DemoAirlineContractTest extends FlightIntegrationTest {

    // Days 11 to 17 ahead are used by no other test, so the seat counts are this test's own.

    @Autowired
    DemoFlightProvider airline;

    @Test
    void aHoldOfSeveralFlightsIsAllOrNothing() {
        SeatRequest out = seats(flight("DEL", "BOM", 11), 2);
        SeatRequest back = seats(flight("BOM", "DEL", 13), 2);
        // Somebody holds every economy seat of the return flight.
        SeatRequest everySeatBack = new SeatRequest(back.scheduleId(), back.date(), back.cabin(), 150);
        assertThat(airline.hold(List.of(everySeatBack))).isTrue();

        assertThat(airline.hold(List.of(out, back))).isFalse();
        // The outbound seats taken before the return flight failed were given back.
        assertThat(held(out)).isZero();

        airline.release(List.of(everySeatBack));
        assertThat(airline.hold(List.of(out, back))).isTrue();
        assertThat(held(out)).isEqualTo(2);
        assertThat(held(back)).isEqualTo(2);

        // Releasing more than is held changes nothing (never a negative count).
        airline.release(List.of(new SeatRequest(out.scheduleId(), out.date(), out.cabin(), 5)));
        assertThat(held(out)).isEqualTo(2);
    }

    @Test
    void anOrderIsCreatedAtMostOncePerIdempotencyKey() {
        SeatRequest seat = seats(flight("DEL", "BOM", 15), 1);
        assertThat(airline.hold(List.of(seat, seat, seat))).isTrue();

        OrderRequest request = order("order-key-1", "Rao", seat);
        SupplierOrder first = airline.createOrder(request);
        SupplierOrder again = airline.createOrder(request);

        assertThat(again).isEqualTo(first);
        assertThat(first.pnr()).matches("[A-Z2-9]{6}");
        assertThat(first.tickets()).singleElement().satisfies(ticket -> assertThat(ticket.passengerNo()).isEqualTo(1));
        assertThat(airline.findOrder("order-key-1")).contains(first);
        assertThat(sold(seat)).isEqualTo(1);
        assertThat(held(seat)).isEqualTo(2);

        // The airline issues the order but its answer is lost: the order exists and the same key finds it.
        assertThatThrownBy(() -> airline.createOrder(order("order-key-2", "TIMEOUT", seat)))
                .isInstanceOf(SupplierTimeoutException.class);
        SupplierOrder issued = airline.findOrder("order-key-2").orElseThrow();
        assertThat(airline.createOrder(order("order-key-2", "TIMEOUT", seat))).isEqualTo(issued);
        assertThat(sold(seat)).isEqualTo(2);

        // The request is lost before the airline sees it: no order, the seat is still only held.
        assertThatThrownBy(() -> airline.createOrder(order("order-key-3", "TIMEOUTLOST", seat)))
                .isInstanceOf(SupplierTimeoutException.class);
        assertThat(airline.findOrder("order-key-3")).isEmpty();
        assertThat(sold(seat)).isEqualTo(2);
        assertThat(held(seat)).isEqualTo(1);

        assertThatThrownBy(() -> airline.createOrder(order("order-key-4", "REJECT", seat)))
                .isInstanceOf(SupplierRejectedException.class);
        assertThat(airline.findOrder("order-key-4")).isEmpty();
    }

    @Test
    void cancellingTwiceGivesTheSeatsBackOnceAtTheFareFamilysFee() {
        SeatRequest seat = seats(flight("DEL", "BOM", 17), 1);
        assertThat(airline.hold(List.of(seat))).isTrue();
        SupplierOrder order = airline.createOrder(order("order-key-5", "Rao", seat));
        assertThat(sold(seat)).isEqualTo(1);

        SupplierCancellation cancelled = airline.cancelOrder(order.supplierOrderId(), "cancel-key-1");
        // 25 % of the 5 000 fare is kept; the rest of the 6 000 paid comes back.
        assertThat(cancelled.penalty()).isEqualByComparingTo("1250.00");
        assertThat(cancelled.refund()).isEqualByComparingTo("4750.00");
        assertThat(sold(seat)).isZero();

        SupplierCancellation again = airline.cancelOrder(order.supplierOrderId(), "cancel-key-2");
        assertThat(again).isEqualTo(cancelled);
        assertThat(airline.findCancellation(order.supplierOrderId())).contains(cancelled);
        assertThat(sold(seat)).isZero();

        assertThatThrownBy(() -> airline.cancelOrder("DO-UNKNOWN", "cancel-key-3"))
                .isInstanceOfSatisfying(SupplierRejectedException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo("NOT_CANCELLABLE"));
    }

    // ------------------------------------------------------------------ helpers

    private OptionRef flight(String from, String to, int daysAhead) {
        return airline.search(new SearchCriteria(from, to, date(daysAhead), new Passengers(1, 0, 0), "ECONOMY"))
                .getFirst().ref();
    }

    private static SeatRequest seats(OptionRef flight, int seats) {
        return new SeatRequest(flight.scheduleId(), flight.date(), flight.cabin(), seats);
    }

    private static OrderRequest order(String key, String lastName, SeatRequest seat) {
        return new OrderRequest(key, List.of(new OrderPassenger(1, "ADULT", "Asha", lastName)), List.of(seat),
                new OrderPricing(new BigDecimal("5000.00"), new BigDecimal("6000.00"), "INR", 25));
    }

    private int held(SeatRequest seat) {
        return count("seats_held", seat);
    }

    private int sold(SeatRequest seat) {
        return count("seats_sold", seat);
    }

    private int count(String column, SeatRequest seat) {
        return jdbcClient.sql("SELECT " + column + " FROM demo_seat_inventory WHERE schedule_id = UUID_TO_BIN(:id) "
                        + "AND flight_date = :date AND cabin = :cabin")
                .param("id", seat.scheduleId()).param("date", Date.valueOf(seat.date())).param("cabin", seat.cabin())
                .query(Integer.class).optional().orElse(0);
    }
}
