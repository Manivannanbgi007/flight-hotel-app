package com.flighthotel.flight.booking;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.apache.avro.specific.SpecificRecord;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.events.common.FlightSegmentInfo;
import com.flighthotel.events.common.FlightSlice;
import com.flighthotel.events.flight.FlightBookingCancelled;
import com.flighthotel.events.flight.FlightBookingConfirmed;
import com.flighthotel.events.flight.FlightBookingFailed;
import com.flighthotel.events.flight.FlightBookingUncertain;
import com.flighthotel.events.flight.FlightCancellationFailed;
import com.flighthotel.events.flight.FlightOfferHeld;
import com.flighthotel.events.flight.FlightOfferHoldFailed;
import com.flighthotel.events.flight.FlightOfferReleased;
import com.flighthotel.events.flight.FlightPriceLine;
import com.flighthotel.events.flight.FlightTicketInfo;
import com.flighthotel.flight.dto.FlightDtos.TripOffer;
import com.flighthotel.flight.dto.FlightDtos.TripSlice;
import com.flighthotel.flight.entity.SupplierBooking;
import com.flighthotel.flight.integration.FlightModel.SupplierOrder;
import com.flighthotel.flight.integration.demo.ReferenceData;

/** flight-service's saga messages ({@code flight.events}, key = booking id), written to the outbox in the same transaction. */
@Component
public class FlightEvents {

    static final String AGGREGATE_TYPE = "flight";

    private final OutboxEventPublisher outbox;
    private final ReferenceData reference;

    public FlightEvents(OutboxEventPublisher outbox, ReferenceData reference) {
        this.outbox = outbox;
        this.reference = reference;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void held(SupplierBooking booking, TripOffer trip, Instant now) {
        String currency = trip.currency();
        publish(booking.getBookingId(), FlightOfferHeld.newBuilder()
                .setBookingId(booking.getBookingId().toString())
                .setHoldId(booking.getId().toString())
                .setProvider(trip.provider())
                .setDemo(trip.demo())
                .setTitle(trip.title())
                .setTripType(trip.tripType())
                .setCabin(trip.cabin())
                .setFareName(trip.slices().getFirst().fare().name())
                .setRefundable(trip.refundable())
                .setCheckedBaggageKg(trip.checkedBaggageKg())
                .setCabinBaggageKg(trip.cabinBaggageKg())
                .setCancellationFeePercent(trip.slices().stream().mapToInt(s -> s.fare().cancellationFeePercent())
                        .max().orElse(100))
                .setCancellationPolicy(trip.cancellationPolicy())
                .setSlices(slices(trip.slices()))
                .setAdults(trip.passengers().adults())
                .setChildren(trip.passengers().children())
                .setInfants(trip.passengers().infants())
                .setSubtotal(EventMoney.of(trip.subtotal(), currency))
                .setTaxes(EventMoney.of(trip.taxes(), currency))
                .setPriceLines(trip.priceLines().stream().map(line -> FlightPriceLine.newBuilder()
                        .setLabel(line.label()).setAmount(EventMoney.of(line.amount(), currency)).build()).toList())
                .setTotal(EventMoney.of(trip.total(), currency))
                .setHoldExpiresAt(booking.getHoldExpiresAt())
                .setHeldAt(now)
                .setDepartureAt(departureAt(trip))
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void holdFailed(UUID bookingId, String reason, String message, BigDecimal newTotal, String title,
            Instant now) {
        publish(bookingId, FlightOfferHoldFailed.newBuilder()
                .setBookingId(bookingId.toString())
                .setReason(reason)
                .setMessage(message)
                .setNewTotal(newTotal == null ? null : EventMoney.of(newTotal, "INR"))
                .setTitle(title)
                .setFailedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void released(SupplierBooking booking, String reason, Instant now) {
        publish(booking.getBookingId(), FlightOfferReleased.newBuilder()
                .setBookingId(booking.getBookingId().toString())
                .setHoldId(booking.getId().toString())
                .setReason(reason)
                .setReleasedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void confirmed(SupplierBooking booking, SupplierOrder order, Instant now) {
        publish(booking.getBookingId(), FlightBookingConfirmed.newBuilder()
                .setBookingId(booking.getBookingId().toString())
                .setHoldId(booking.getId().toString())
                .setSupplierOrderId(order.supplierOrderId())
                .setPnr(order.pnr())
                .setTickets(order.tickets().stream().map(t -> FlightTicketInfo.newBuilder()
                        .setPassengerIndex(t.passengerNo()).setTicketNumber(t.ticketNumber()).build()).toList())
                .setConfirmedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void failed(SupplierBooking booking, String reason, String message, Instant now) {
        publish(booking.getBookingId(), FlightBookingFailed.newBuilder()
                .setBookingId(booking.getBookingId().toString())
                .setHoldId(booking.getId().toString())
                .setReason(reason)
                .setMessage(message)
                .setFailedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void uncertain(SupplierBooking booking, Instant now) {
        publish(booking.getBookingId(), FlightBookingUncertain.newBuilder()
                .setBookingId(booking.getBookingId().toString())
                .setHoldId(booking.getId().toString())
                .setReason("SUPPLIER_TIMEOUT")
                .setSince(now)
                .build());
    }

    /** Answer to BookingCancellationRequested (repeatable with the same content). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void cancelled(SupplierBooking booking) {
        publish(booking.getBookingId(), FlightBookingCancelled.newBuilder()
                .setBookingId(booking.getBookingId().toString())
                .setHoldId(booking.getId().toString())
                .setCancellationId(booking.getCancellationId())
                .setSupplierOrderId(booking.getSupplierOrderId())
                .setCancellationReference(booking.getCancellationReference())
                .setAirlineFee(EventMoney.of(booking.getCancelFee(), booking.getCurrency()))
                .setAirlineRefund(EventMoney.of(booking.getCancelRefund(), booking.getCurrency()))
                .setCancelledAt(booking.getCancelledAt())
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void cancellationFailed(UUID bookingId, String cancellationId, String reason, String message, Instant now) {
        publish(bookingId, FlightCancellationFailed.newBuilder()
                .setBookingId(bookingId.toString())
                .setCancellationId(cancellationId)
                .setReason(reason)
                .setMessage(message)
                .setFailedAt(now)
                .build());
    }

    /** The first departure as an instant (origin airport time zone), for cancellation deadlines. */
    Instant departureAt(TripOffer trip) {
        TripSlice first = trip.slices().getFirst();
        String zone = reference.timezone(first.origin().iataCode());
        return java.time.LocalDateTime.parse(first.departureLocal())
                .atZone(java.time.ZoneId.of(zone == null ? "Asia/Kolkata" : zone)).toInstant();
    }

    static List<FlightSlice> slices(List<TripSlice> slices) {
        return slices.stream().map(slice -> FlightSlice.newBuilder()
                .setOrigin(slice.origin().iataCode())
                .setDestination(slice.destination().iataCode())
                .setOriginCity(slice.origin().city())
                .setDestinationCity(slice.destination().city())
                .setDepartureLocal(slice.departureLocal())
                .setArrivalLocal(slice.arrivalLocal())
                .setDurationMinutes(slice.durationMinutes())
                .setStops(slice.stops())
                .setSegments(slice.segments().stream().map(segment -> FlightSegmentInfo.newBuilder()
                        .setFlightNumber(segment.flightNumber())
                        .setAirlineCode(segment.airlineCode())
                        .setAirlineName(segment.airlineName())
                        .setOrigin(segment.origin())
                        .setDestination(segment.destination())
                        .setDepartureLocal(segment.departureLocal())
                        .setArrivalLocal(segment.arrivalLocal())
                        .setDurationMinutes(segment.durationMinutes())
                        .build()).toList())
                .build()).toList();
    }

    private void publish(UUID bookingId, SpecificRecord event) {
        outbox.publish(AGGREGATE_TYPE, bookingId.toString(), event);
    }
}
