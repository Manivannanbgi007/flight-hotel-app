package com.flighthotel.booking.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.dto.BookingDtos.SliceView;
import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingPassenger;
import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.FlightBooking;
import com.flighthotel.booking.entity.PriceItem;
import com.flighthotel.booking.entity.RefundRequest;
import com.flighthotel.booking.repository.BookingPassengerRepository;
import com.flighthotel.booking.repository.FlightBookingRepository;
import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.common.FlightSlice;
import com.flighthotel.events.flight.FlightBookingConfirmed;
import com.flighthotel.events.flight.FlightBookingFailed;
import com.flighthotel.events.flight.FlightBookingUncertain;
import com.flighthotel.events.flight.FlightOfferHeld;
import com.flighthotel.events.flight.FlightOfferHoldFailed;
import com.flighthotel.events.flight.FlightOfferReleased;
import com.flighthotel.events.flight.FlightTicketInfo;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * booking-service's reactions in the flight booking saga (BOOKING_WORKFLOW.md section 3), the counterpart of the hotel
 * handlers in {@link BookingSaga}: each runs in the Kafka listener's transaction, locks the booking, ignores events that
 * no longer fit its status and writes follow-up events to the outbox.
 */
@Service
public class FlightSaga {

    private static final Logger log = LoggerFactory.getLogger(FlightSaga.class);

    private final BookingSaga saga;
    private final FlightBookingRepository flightBookings;
    private final BookingPassengerRepository passengers;
    private final CouponService coupons;
    private final BookingLifecycle lifecycle;
    private final BookingEvents events;
    private final JsonMapper json;
    private final Duration paymentGrace;
    private final CancellationPolicy policy;
    private final Clock clock;

    public FlightSaga(BookingSaga saga, FlightBookingRepository flightBookings,
            BookingPassengerRepository passengers, CouponService coupons, BookingLifecycle lifecycle,
            BookingEvents events, JsonMapper json, @Value("${booking.payment-grace:5m}") Duration paymentGrace,
            CancellationPolicy policy, Clock clock) {
        this.saga = saga;
        this.flightBookings = flightBookings;
        this.passengers = passengers;
        this.coupons = coupons;
        this.lifecycle = lifecycle;
        this.events = events;
        this.json = json;
        this.paymentGrace = paymentGrace;
        this.policy = policy;
        this.clock = clock;
    }

    /** Seats held at a final price: apply the coupon, fix the total, open the payment window. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void held(FlightOfferHeld held, String eventId) {
        Booking booking = saga.lock(held.getBookingId(), "FlightOfferHeld");
        if (booking == null || !BookingSaga.expect(booking, BookingStatus.INITIATED, "FlightOfferHeld")) {
            // E.g. the booking already failed after waiting too long; flight-service releases the seats on BookingFailed.
            return;
        }
        Instant now = clock.instant();
        FlightBooking flight = flightBookings.findById(booking.getId()).orElseThrow();
        List<SliceView> slices = FlightMapper.views(held.getSlices());
        flight.held(held, json.writeValueAsString(slices));
        FlightSlice first = held.getSlices().getFirst();
        FlightSlice last = held.getSlices().getLast();
        String destination = first.getDestinationCity();
        booking.inventoryHeld(held.getTitle(), destination, date(first.getDepartureLocal()),
                date(last.getArrivalLocal()), held.getHoldExpiresAt(), held.getHoldExpiresAt().minus(paymentGrace),
                held.getProvider(), held.getCancellationPolicy(),
                CancellationPolicy.flightDeparture(held.getDepartureAt(), first.getDepartureLocal()),
                policy.flightCancelUntil(held.getDepartureAt(), first.getDepartureLocal()));

        String currency = held.getTotal().getCurrency();
        BigDecimal subtotal = EventMoney.amount(held.getSubtotal());
        BigDecimal taxes = EventMoney.amount(held.getTaxes());
        BigDecimal total = EventMoney.amount(held.getTotal());
        CouponService.Applied coupon = coupons.apply(booking, total, destination);

        List<PriceItem> items = new ArrayList<>();
        held.getPriceLines().forEach(line -> items.add(new PriceItem(type(line.getLabel()), line.getLabel(),
                EventMoney.amount(line.getAmount()))));
        if (coupon.discount().signum() > 0) {
            items.add(new PriceItem(PriceItem.DISCOUNT, "Coupon " + coupon.code(), coupon.discount().negate()));
        }
        if (coupon.note() != null) {
            booking.couponNotApplied(coupon.note());
        }
        booking.price(subtotal, taxes, coupon.discount(), currency, items);

        lifecycle.move(booking, BookingStatus.PENDING_PAYMENT, "Seats held at the quoted fare", eventId);
        events.awaitingPayment(booking, describe(held), now);
        log.info("Flight booking awaiting payment reference={} total={} deadline={}", booking.getBookingReference(),
                booking.getTotalAmount(), booking.getPaymentDeadline());
    }

    /** Offer expired, sold out, fare changed, ...: nothing is held, nothing was paid. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void holdFailed(FlightOfferHoldFailed failed, String eventId) {
        Booking booking = saga.lock(failed.getBookingId(), "FlightOfferHoldFailed");
        if (booking == null || !BookingSaga.expect(booking, BookingStatus.INITIATED, "FlightOfferHoldFailed")) {
            return;
        }
        String message = failed.getMessage();
        if (failed.getNewTotal() != null) {
            message += " Today's fare for the same trip is "
                    + Amounts.format(EventMoney.amount(failed.getNewTotal()), failed.getNewTotal().getCurrency())
                    + ".";
        }
        booking.failed(failed.getReason(), message, failed.getTitle());
        lifecycle.move(booking, BookingStatus.FAILED, message, eventId);
        events.failed(booking, failed.getReason(), clock.instant());
        log.info("Flight booking failed reference={} reason={}", booking.getBookingReference(), failed.getReason());
    }

    /** Seats back on sale; only "not paid in time" needs action here. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void released(FlightOfferReleased released, String eventId) {
        saga.expireUnpaid(released.getBookingId(), released.getReason(), eventId);
    }

    /** The airline issued the booking: PNR and tickets exist, done. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void confirmed(FlightBookingConfirmed confirmed, String eventId) {
        Booking booking = saga.lock(confirmed.getBookingId(), "FlightBookingConfirmed");
        if (booking == null || !BookingSaga.expect(booking, BookingStatus.SUPPLIER_PENDING,
                "FlightBookingConfirmed")) {
            return;
        }
        Instant now = clock.instant();
        FlightBooking flight = flightBookings.findById(booking.getId()).orElseThrow();
        flight.confirmed(confirmed.getPnr());
        List<BookingPassenger> travellers = passengers.findByBookingIdOrderByPassengerNo(booking.getId());
        Map<Integer, String> tickets = confirmed.getTickets().stream()
                .collect(Collectors.toMap(FlightTicketInfo::getPassengerIndex, FlightTicketInfo::getTicketNumber));
        travellers.forEach(p -> p.ticket(tickets.get(p.getPassengerNo())));
        booking.confirmed(now);
        coupons.consume(booking.getId());
        lifecycle.move(booking, BookingStatus.CONFIRMED, "Confirmed by the airline", eventId);
        events.confirmedFlight(booking, flight, travellers, slicesOf(flight), now);
        log.info("Flight booking confirmed reference={} pnr={}", booking.getBookingReference(), confirmed.getPnr());
    }

    /** Paid, but the airline did not issue the booking: full refund. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void failed(FlightBookingFailed failed, String eventId) {
        Booking booking = saga.lock(failed.getBookingId(), "FlightBookingFailed");
        if (booking == null || !BookingSaga.expect(booking, BookingStatus.SUPPLIER_PENDING, "FlightBookingFailed")) {
            return;
        }
        booking.failed(failed.getReason(),
                "The airline could not issue your tickets. Your payment is being refunded in full.", null);
        coupons.release(booking.getId());
        lifecycle.move(booking, BookingStatus.REFUND_PENDING, "The airline could not issue the tickets ("
                + failed.getReason() + "); full refund started", eventId);
        saga.requestRefund(booking, booking.getPaidPaymentId(), booking.getTotalAmount(),
                RefundRequest.BOOKING_FAILED);
    }

    /** The airline did not answer: the outcome is unknown. The customer waits; flight-service looks the order up. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void uncertain(FlightBookingUncertain uncertain, String eventId) {
        Booking booking = saga.lock(uncertain.getBookingId(), "FlightBookingUncertain");
        if (booking == null || booking.getStatus() != BookingStatus.SUPPLIER_PENDING) {
            return;
        }
        lifecycle.note(booking, "The airline has not answered yet. Your payment is safe: we are checking and will "
                + "confirm your tickets or refund you.", eventId);
    }

    // ------------------------------------------------------------------ helpers

    List<SliceView> slicesOf(FlightBooking flight) {
        return json.readValue(flight.getSlicesJson(), new TypeReference<List<SliceView>>() { });
    }

    private static LocalDate date(String local) {
        return LocalDate.parse(local.substring(0, 10));
    }

    private static String type(String label) {
        if (label.startsWith("Fare")) {
            return PriceItem.FARE;
        }
        return label.startsWith("GST") ? PriceItem.TAX : PriceItem.FEE;
    }

    /** "Delhi to Mumbai · 2 travellers · Economy", shown on the payment page and to the payment provider. */
    static String describe(FlightOfferHeld held) {
        int travellers = held.getAdults() + held.getChildren() + held.getInfants();
        return held.getTitle() + " · " + travellers + (travellers == 1 ? " traveller" : " travellers") + " · "
                + held.getCabin().charAt(0) + held.getCabin().substring(1).toLowerCase().replace('_', ' ');
    }
}
