package com.flighthotel.booking.service;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.List;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.dto.BookingDtos.SliceView;
import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingPassenger;
import com.flighthotel.booking.entity.Cancellation;
import com.flighthotel.booking.entity.FlightBooking;
import com.flighthotel.booking.entity.HotelBooking;
import com.flighthotel.booking.entity.RefundRequest;
import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.events.booking.BookingAwaitingPayment;
import com.flighthotel.events.booking.BookingCancellationFailed;
import com.flighthotel.events.booking.BookingCancellationRequested;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingCompleted;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.BookingExpired;
import com.flighthotel.events.booking.BookingFailed;
import com.flighthotel.events.booking.BookingInitiated;
import com.flighthotel.events.booking.BookingPaid;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.booking.ConfirmedFlightPassenger;
import com.flighthotel.events.booking.ConfirmedFlightTrip;
import com.flighthotel.events.booking.ConfirmedHotelStay;
import com.flighthotel.events.booking.FlightBookingRequest;
import com.flighthotel.events.booking.FlightPassengerInfo;
import com.flighthotel.events.booking.HotelBookingRequest;
import com.flighthotel.events.booking.HotelGuest;

/**
 * booking-service's saga messages ({@code booking.events}, key = booking id). Always written to the outbox in the
 * transaction that changed the booking, so the event exists exactly when the change does.
 */
@Component
public class BookingEvents {

    static final String AGGREGATE_TYPE = "booking";
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

    private final OutboxEventPublisher outbox;

    public BookingEvents(OutboxEventPublisher outbox) {
        this.outbox = outbox;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void initiated(Booking booking, HotelBooking hotel, Instant now) {
        publish(booking, BookingInitiated.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingReference(booking.getBookingReference())
                .setUserId(booking.getUserId().toString())
                .setBookingType(booking.getBookingType().name())
                .setHotel(HotelBookingRequest.newBuilder()
                        .setQuoteId(hotel.getQuoteId().toString())
                        .setGuests(hotel.getGuests().stream()
                                .map(g -> HotelGuest.newBuilder().setRoomNo(g.getRoomNo())
                                        .setFirstName(g.getFirstName()).setLastName(g.getLastName()).build())
                                .toList())
                        .setContactEmail(booking.getContactEmail())
                        .setContactPhone(booking.getContactPhone())
                        .setSpecialRequests(hotel.getSpecialRequests())
                        .build())
                .setInitiatedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void initiatedFlight(Booking booking, String offerId, List<BookingPassenger.Details> passengers,
            Instant now) {
        publish(booking, BookingInitiated.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingReference(booking.getBookingReference())
                .setUserId(booking.getUserId().toString())
                .setBookingType(booking.getBookingType().name())
                .setFlight(FlightBookingRequest.newBuilder()
                        .setOfferId(offerId)
                        // Names, types, dates of birth: never passport numbers (they stay in this service, encrypted).
                        .setPassengers(passengers.stream().map(p -> FlightPassengerInfo.newBuilder()
                                .setIndex(p.passengerNo()).setPassengerType(p.type()).setFirstName(p.firstName())
                                .setLastName(p.lastName()).setDateOfBirth(p.dateOfBirth()).setGender(p.gender())
                                .setNationality(p.nationality()).build()).toList())
                        .setContactEmail(booking.getContactEmail())
                        .setContactPhone(booking.getContactPhone())
                        .build())
                .setInitiatedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void confirmedFlight(Booking booking, FlightBooking flight, List<BookingPassenger> passengers,
            List<SliceView> slices, Instant now) {
        String currency = booking.getCurrency();
        publish(booking, BookingConfirmed.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingReference(booking.getBookingReference())
                .setUserId(booking.getUserId().toString())
                .setBookingType(booking.getBookingType().name())
                .setContactEmail(booking.getContactEmail())
                .setCustomerName(passengers.getFirst().fullName())
                .setPaymentId(booking.getPaidPaymentId().toString())
                .setBaseAmount(EventMoney.of(booking.getBaseAmount(), currency))
                .setTaxAmount(EventMoney.of(booking.getTaxAmount(), currency))
                .setDiscountAmount(EventMoney.of(booking.getDiscountAmount(), currency))
                .setTotalAmount(EventMoney.of(booking.getTotalAmount(), currency))
                .setFlight(ConfirmedFlightTrip.newBuilder()
                        .setTitle(booking.getTitle())
                        .setTripType(flight.getTripType())
                        .setCabin(flight.getCabin())
                        .setFareName(flight.getFareName())
                        .setRefundable(flight.getRefundable())
                        .setCheckedBaggageKg(flight.getCheckedBaggageKg())
                        .setCabinBaggageKg(flight.getCabinBaggageKg())
                        .setCancellationPolicy(booking.getCancellationPolicySnapshot())
                        .setSlices(FlightMapper.avro(slices))
                        .setPnr(flight.getPnr())
                        .setPassengers(passengers.stream().map(p -> ConfirmedFlightPassenger.newBuilder()
                                .setIndex(p.getPassengerNo()).setPassengerType(p.getPassengerType())
                                .setFirstName(p.getFirstName()).setLastName(p.getLastName())
                                .setTicketNumber(p.getTicketNumber()).build()).toList())
                        .setDemo(flight.isDemo())
                        .build())
                .setConfirmedAt(now)
                .setStartsAt(booking.getStartsAt())
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void awaitingPayment(Booking booking, String description, Instant now) {
        publish(booking, BookingAwaitingPayment.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingReference(booking.getBookingReference())
                .setUserId(booking.getUserId().toString())
                .setBookingType(booking.getBookingType().name())
                .setAmount(EventMoney.of(booking.getTotalAmount(), booking.getCurrency()))
                .setDescription(description)
                .setContactEmail(booking.getContactEmail())
                .setContactPhone(booking.getContactPhone())
                .setPaymentDeadline(booking.getPaymentDeadline())
                .setOccurredAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void paid(Booking booking, Instant now) {
        publish(booking, BookingPaid.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingType(booking.getBookingType().name())
                .setPaymentId(booking.getPaidPaymentId().toString())
                .setPaidAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void confirmed(Booking booking, HotelBooking hotel, Instant now) {
        String currency = booking.getCurrency();
        publish(booking, BookingConfirmed.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingReference(booking.getBookingReference())
                .setUserId(booking.getUserId().toString())
                .setBookingType(booking.getBookingType().name())
                .setContactEmail(booking.getContactEmail())
                .setCustomerName(hotel.leadGuest().fullName())
                .setPaymentId(booking.getPaidPaymentId().toString())
                .setBaseAmount(EventMoney.of(booking.getBaseAmount(), currency))
                .setTaxAmount(EventMoney.of(booking.getTaxAmount(), currency))
                .setDiscountAmount(EventMoney.of(booking.getDiscountAmount(), currency))
                .setTotalAmount(EventMoney.of(booking.getTotalAmount(), currency))
                .setHotel(ConfirmedHotelStay.newBuilder()
                        .setHotelName(hotel.getHotelName())
                        .setHotelCity(hotel.getHotelCity())
                        .setHotelAddress(hotel.getHotelAddress())
                        .setRoomTypeName(hotel.getRoomTypeName())
                        .setRatePlanName(hotel.getRatePlanName())
                        .setCheckIn(hotel.getCheckIn())
                        .setCheckOut(hotel.getCheckOut())
                        .setCheckInTime(hotel.getCheckInTime())
                        .setCheckOutTime(hotel.getCheckOutTime())
                        .setNights(hotel.getNights())
                        .setRooms(hotel.getRooms())
                        .setAdults(hotel.getAdults())
                        .setChildren(hotel.getChildren())
                        .setConfirmationNumber(hotel.getConfirmationNumber())
                        .setCancellationPolicy(booking.getCancellationPolicySnapshot())
                        .setDemo(hotel.isDemo())
                        .build())
                .setConfirmedAt(now)
                .setStartsAt(booking.getStartsAt())
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void failed(Booking booking, String reason, Instant now) {
        publish(booking, BookingFailed.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingType(booking.getBookingType().name())
                .setReason(reason)
                .setFailedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void expired(Booking booking, Instant now) {
        publish(booking, BookingExpired.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingType(booking.getBookingType().name())
                .setExpiredAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void refundRequested(Booking booking, RefundRequest refund, String customerName, Instant now) {
        publish(booking, BookingRefundRequested.newBuilder()
                .setRefundRequestId(refund.getId().toString())
                .setBookingId(booking.getId().toString())
                .setBookingReference(booking.getBookingReference())
                .setUserId(booking.getUserId().toString())
                .setPaymentId(refund.getPaymentId().toString())
                .setAmount(EventMoney.of(refund.getAmount(), refund.getCurrency()))
                .setReason(refund.getReason())
                .setContactEmail(booking.getContactEmail())
                .setCustomerName(customerName)
                .setRequestedAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void completed(Booking booking, Instant now) {
        publish(booking, BookingCompleted.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingType(booking.getBookingType().name())
                .setCompletedAt(now)
                .build());
    }

    /** Ask the hotel or airline to cancel (also sent again, with the same content, by the reconciliation job). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void cancellationRequested(Booking booking, Cancellation cancellation) {
        publish(booking, BookingCancellationRequested.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingReference(booking.getBookingReference())
                .setBookingType(booking.getBookingType().name())
                .setCancellationId(cancellation.getId().toString())
                .setInitiatedBy(cancellation.getInitiatedBy())
                .setRequestedAt(cancellation.getRequestedAt())
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void cancelled(Booking booking, Cancellation cancellation, String customerName, Instant now) {
        String currency = booking.getCurrency();
        publish(booking, BookingCancelled.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingReference(booking.getBookingReference())
                .setBookingType(booking.getBookingType().name())
                .setUserId(booking.getUserId().toString())
                .setCancellationId(cancellation.getId().toString())
                .setTitle(booking.getTitle() == null ? booking.getBookingReference() : booking.getTitle())
                .setContactEmail(booking.getContactEmail())
                .setCustomerName(customerName)
                .setInitiatedBy(cancellation.getInitiatedBy())
                .setPaidAmount(EventMoney.of(cancellation.getPaidAmount(), currency))
                .setCancellationFee(EventMoney.of(cancellation.getCancellationFee(), currency))
                .setRefundAmount(EventMoney.of(cancellation.getRefundAmount(), currency))
                .setFeeWaived(cancellation.isFeeWaived())
                .setSupplierReference(cancellation.getSupplierReference())
                .setCancelledAt(now)
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void cancellationFailed(Booking booking, Cancellation cancellation, String customerName, Instant now) {
        publish(booking, BookingCancellationFailed.newBuilder()
                .setBookingId(booking.getId().toString())
                .setBookingReference(booking.getBookingReference())
                .setBookingType(booking.getBookingType().name())
                .setUserId(booking.getUserId().toString())
                .setCancellationId(cancellation.getId().toString())
                .setTitle(booking.getTitle() == null ? booking.getBookingReference() : booking.getTitle())
                .setContactEmail(booking.getContactEmail())
                .setCustomerName(customerName)
                .setReason(cancellation.getFailureReason())
                .setMessage(cancellation.getFailureMessage())
                .setFailedAt(now)
                .build());
    }

    /** "Sea Breeze Resort · 2 nights · 1 room", shown on the payment page and to the payment provider. */
    public static String describe(HotelBooking hotel) {
        int nights = hotel.getNights() == null ? 0 : hotel.getNights();
        int rooms = hotel.getRooms() == null ? 0 : hotel.getRooms();
        return hotel.getHotelName() + " · " + nights + (nights == 1 ? " night" : " nights") + " · " + rooms
                + (rooms == 1 ? " room" : " rooms");
    }

    static String time(java.time.LocalTime time) {
        return TIME.format(time);
    }

    private void publish(Booking booking, org.apache.avro.specific.SpecificRecord event) {
        outbox.publish(AGGREGATE_TYPE, booking.getId().toString(), event);
    }
}
