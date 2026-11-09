package com.flighthotel.notification.document;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.springframework.stereotype.Component;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.ConfirmedFlightPassenger;
import com.flighthotel.events.booking.ConfirmedFlightTrip;
import com.flighthotel.events.booking.ConfirmedHotelStay;
import com.flighthotel.events.common.FlightSegmentInfo;
import com.flighthotel.events.common.FlightSlice;
import com.flighthotel.events.common.Money;
import com.flighthotel.events.payment.InvoiceIssued;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.notification.document.PdfDocument.Page;
import com.flighthotel.notification.document.PdfDocument.Row;
import com.flighthotel.notification.document.PdfDocument.Section;
import com.flighthotel.notification.document.PdfDocument.Table;
import com.flighthotel.notification.email.BookingEmailComposer;
import com.flighthotel.notification.projection.BookingContacts.BookingContact;

/**
 * What each document says (requirement section 18), built only from the server's own events: the confirmed booking
 * snapshot, the invoice, the verified payment, the confirmed cancellation and the completed refund. Times are shown in
 * India time; flight times are the airports' local times, as on the booking.
 */
@Component
public class DocumentFactory {

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("EEE, d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.ENGLISH);

    // ------------------------------------------------------------------ booking confirmations

    public PdfDocument hotelConfirmation(BookingConfirmed confirmed) {
        ConfirmedHotelStay stay = confirmed.getHotel();
        List<Section> sections = new ArrayList<>();
        sections.add(Section.rows("Reservation", List.of(
                Row.of("Booking reference", confirmed.getBookingReference()),
                Row.of("Hotel confirmation number", stay.getConfirmationNumber()),
                Row.of("Lead guest", confirmed.getCustomerName()),
                Row.of("Rooms and guests", plural(stay.getRooms(), "room") + " · " + plural(stay.getAdults(), "adult")
                        + (stay.getChildren() > 0 ? ", " + plural(stay.getChildren(), "child", "children") : "")))));
        sections.add(Section.rows("Your stay", List.of(
                Row.of("Hotel", stay.getHotelName()),
                Row.of("Address", stay.getHotelAddress()),
                Row.of("Check-in", DATE.format(stay.getCheckIn()) + ", from " + stay.getCheckInTime()),
                Row.of("Check-out", DATE.format(stay.getCheckOut()) + ", until " + stay.getCheckOutTime()),
                Row.of("Nights", String.valueOf(stay.getNights())),
                Row.of("Room", stay.getRoomTypeName()),
                Row.of("Rate", stay.getRatePlanName()))));
        sections.add(payment("Room charges", confirmed));
        return new PdfDocument("Hotel booking confirmation", confirmed.getBookingReference(),
                issued(confirmed.getConfirmedAt()), stay.getDemo(), List.of(new Page(stay.getHotelName(), sections,
                List.of("Show this confirmation and a photo ID at check-in.",
                        "Cancellation policy: " + stay.getCancellationPolicy()))));
    }

    public PdfDocument flightItinerary(BookingConfirmed confirmed) {
        ConfirmedFlightTrip trip = confirmed.getFlight();
        List<Section> sections = new ArrayList<>();
        sections.add(Section.rows("Booking", List.of(
                Row.of("Booking reference", confirmed.getBookingReference()),
                Row.of("Airline booking reference (PNR)", trip.getPnr()),
                Row.of("Trip", "ROUND_TRIP".equals(trip.getTripType()) ? "Round trip" : "One way"),
                Row.of("Cabin and fare", words(trip.getCabin()) + " · " + trip.getFareName()),
                Row.of("Baggage", baggage(trip)))));
        sections.addAll(flights(trip));
        sections.add(Section.table("Travellers", new Table(List.of("Traveller", "Type", "Ticket number"),
                trip.getPassengers().stream().map(p -> List.of(name(p), words(p.getPassengerType()),
                        p.getTicketNumber())).toList())));
        sections.add(payment("Fares", confirmed));
        return new PdfDocument("Flight booking confirmation", confirmed.getBookingReference(),
                issued(confirmed.getConfirmedAt()), trip.getDemo(), List.of(new Page(trip.getTitle(), sections,
                List.of("Check in with the airline using the airline booking reference (PNR). Times are local "
                                + "airport times.",
                        "Cancellation policy: " + trip.getCancellationPolicy()))));
    }

    /** One page per traveller with their ticket number (only exists once the airline issued the tickets). */
    public PdfDocument eTicket(BookingConfirmed confirmed) {
        ConfirmedFlightTrip trip = confirmed.getFlight();
        List<Page> pages = new ArrayList<>();
        for (ConfirmedFlightPassenger passenger : trip.getPassengers()) {
            List<Section> sections = new ArrayList<>();
            sections.add(Section.rows("Ticket", List.of(
                    Row.total("Ticket number", passenger.getTicketNumber()),
                    Row.of("Passenger", name(passenger) + " (" + words(passenger.getPassengerType()) + ")"),
                    Row.of("Airline booking reference (PNR)", trip.getPnr()),
                    Row.of("Booking reference", confirmed.getBookingReference()),
                    Row.of("Cabin and fare", words(trip.getCabin()) + " · " + trip.getFareName()),
                    Row.of("Baggage", baggage(trip)))));
            sections.addAll(flights(trip));
            pages.add(new Page("Passenger: " + name(passenger), sections, List.of(
                    "This electronic ticket is valid with a government photo ID matching the passenger's name.",
                    "Times are local airport times. Check the airline's check-in deadlines before you travel.")));
        }
        return new PdfDocument("Electronic ticket", trip.getPnr(), issued(confirmed.getConfirmedAt()), trip.getDemo(),
                pages);
    }

    // ------------------------------------------------------------------ money documents

    public PdfDocument invoice(InvoiceIssued invoice, BookingContact contact) {
        String currency = invoice.getTotalAmount().getCurrency();
        List<Row> details = new ArrayList<>();
        details.add(Row.of("Invoice number", invoice.getInvoiceNumber()));
        details.add(Row.of("Invoice date", issuedDate(invoice.getIssuedAt())));
        details.add(Row.of("Booking reference", first(invoice.getBookingReference(),
                contact == null ? null : contact.bookingReference())));
        details.add(Row.of("Billed to", first(invoice.getBillingName(),
                contact == null ? null : contact.greetingName())));
        details.add(Row.of("E-mail", first(invoice.getBillingEmail(), contact == null ? null : contact.contactEmail())));
        details.add(Row.of("Description", first(invoice.getDescription(),
                contact == null ? null : contact.description())));
        List<Row> amounts = new ArrayList<>();
        if (invoice.getTaxableAmount() != null) {
            amounts.add(Row.of("Taxable value", money(invoice.getTaxableAmount())));
        }
        if (invoice.getTaxAmount() != null) {
            amounts.add(Row.of("GST", money(invoice.getTaxAmount())));
        }
        if (invoice.getDiscountAmount() != null && EventMoney.amount(invoice.getDiscountAmount()).signum() > 0) {
            amounts.add(Row.of("Discount", "- " + money(invoice.getDiscountAmount())));
        }
        amounts.add(Row.total("Total", money(invoice.getTotalAmount())));
        boolean demo = contact != null && contact.demo();
        return new PdfDocument("Tax invoice", invoice.getInvoiceNumber(), issued(invoice.getIssuedAt()), demo,
                List.of(new Page(null, List.of(Section.rows("Invoice", details), Section.rows("Amounts", amounts)),
                        List.of("All amounts in " + ("INR".equals(currency) ? "Indian rupees" : currency)
                                        + ". GST as charged by the hotel or airline for the booked service.",
                                "Paid in full. Invoice numbers are issued without gaps per financial year."))));
    }

    public PdfDocument paymentReceipt(PaymentSucceeded payment, BookingContact contact) {
        String reference = contact == null ? payment.getBookingId() : contact.bookingReference();
        boolean demo = "DEMO".equals(payment.getProvider());
        List<Row> rows = new ArrayList<>();
        rows.add(Row.total("Amount paid", money(payment.getAmount())));
        rows.add(Row.of("Paid on", issuedDate(payment.getSucceededAt())));
        rows.add(Row.of("For", contact == null || contact.description() == null ? "Booking " + reference
                : contact.description()));
        rows.add(Row.of("Booking reference", reference));
        rows.add(Row.of("Payment method", payment.getMethod() == null ? "Online payment" : words(payment.getMethod())));
        rows.add(Row.of("Payment ID", payment.getPaymentId()));
        rows.add(Row.of("Provider", demo ? "Demo payment" : "Razorpay"));
        rows.add(Row.of("Provider reference", payment.getProviderPaymentId()));
        return new PdfDocument("Payment receipt", reference, issued(payment.getSucceededAt()), demo,
                List.of(new Page(null, List.of(Section.rows("Payment", rows)), List.of(
                        "This receipt confirms that we received your payment. The booking is confirmed separately "
                                + "once the hotel or airline confirms it."))));
    }

    public PdfDocument cancellation(BookingCancelled cancelled) {
        List<Row> rows = new ArrayList<>();
        rows.add(Row.of("Booking", cancelled.getTitle()));
        rows.add(Row.of("Booking reference", cancelled.getBookingReference()));
        rows.add(Row.of("Cancelled on", issuedDate(cancelled.getCancelledAt())));
        if (cancelled.getSupplierReference() != null) {
            rows.add(Row.of("FLIGHT".equals(cancelled.getBookingType()) ? "Airline cancellation reference"
                    : "Hotel cancellation number", cancelled.getSupplierReference()));
        }
        rows.add(Row.of("Requested by", switch (cancelled.getInitiatedBy()) {
            case "SUPPORT_AGENT", "ADMIN" -> "Our support team, on your behalf";
            case "HOTEL" -> "The hotel (you pay no fee)";
            default -> "You";
        }));
        rows.add(Row.of("Amount paid", money(cancelled.getPaidAmount())));
        rows.add(Row.of("Cancellation fee", cancelled.getFeeWaived() ? "Waived"
                : money(cancelled.getCancellationFee())));
        rows.add(Row.total("Refund", money(cancelled.getRefundAmount())));
        boolean refund = EventMoney.amount(cancelled.getRefundAmount()).signum() > 0;
        return new PdfDocument("Cancellation confirmation", cancelled.getBookingReference(),
                issued(cancelled.getCancelledAt()), false, List.of(new Page(cancelled.getTitle(),
                List.of(Section.rows("Cancellation", rows)), List.of(refund
                        ? "The refund goes back to the original payment method. Banks usually take 5 to 7 working "
                                + "days to show it; you will receive a refund receipt when it is done."
                        : "Under the cancellation terms of this booking, nothing is refunded."))));
    }

    public PdfDocument refundReceipt(RefundCompleted refund, BookingContact contact) {
        String reference = contact == null ? refund.getBookingId() : contact.bookingReference();
        List<Row> rows = new ArrayList<>();
        rows.add(Row.total("Refund amount", money(refund.getAmount())));
        rows.add(Row.of("Completed on", issuedDate(refund.getCompletedAt())));
        rows.add(Row.of("Booking reference", reference));
        if (contact != null && contact.description() != null) {
            rows.add(Row.of("Booking", contact.description()));
        }
        rows.add(Row.of("Refund ID", refund.getRefundId()));
        rows.add(Row.of("Original payment ID", refund.getPaymentId()));
        return new PdfDocument("Refund receipt", reference, issued(refund.getCompletedAt()),
                contact != null && contact.demo(), List.of(new Page(null, List.of(Section.rows("Refund", rows)),
                List.of("The money was returned to the original payment method. Banks usually take 5 to 7 "
                        + "working days to show it on your statement."))));
    }

    // ------------------------------------------------------------------ helpers

    private List<Section> flights(ConfirmedFlightTrip trip) {
        List<Section> sections = new ArrayList<>();
        List<FlightSlice> slices = trip.getSlices();
        for (int i = 0; i < slices.size(); i++) {
            FlightSlice slice = slices.get(i);
            String heading = (slices.size() == 1 ? "Flight" : i == 0 ? "Outbound" : "Return") + ": "
                    + slice.getOriginCity() + " (" + slice.getOrigin() + ") to " + slice.getDestinationCity() + " ("
                    + slice.getDestination() + ")";
            List<List<String>> rows = new ArrayList<>();
            for (FlightSegmentInfo segment : slice.getSegments()) {
                rows.add(List.of(segment.getFlightNumber() + " · " + segment.getAirlineName(), segment.getOrigin(),
                        local(segment.getDepartureLocal()), segment.getDestination(), local(segment.getArrivalLocal()),
                        duration(segment.getDurationMinutes())));
            }
            sections.add(Section.table(heading, new Table(List.of("Flight", "From", "Departs", "To", "Arrives",
                    "Duration"), rows)));
        }
        return sections;
    }

    private static Section payment(String baseLabel, BookingConfirmed confirmed) {
        List<Row> rows = new ArrayList<>();
        rows.add(Row.of(baseLabel, money(confirmed.getBaseAmount())));
        rows.add(Row.of("Taxes and charges", money(confirmed.getTaxAmount())));
        if (EventMoney.amount(confirmed.getDiscountAmount()).signum() > 0) {
            rows.add(Row.of("Discount", "- " + money(confirmed.getDiscountAmount())));
        }
        rows.add(Row.total("Total paid", money(confirmed.getTotalAmount())));
        return Section.rows("Payment", rows);
    }

    private static String baggage(ConfirmedFlightTrip trip) {
        return "Checked " + trip.getCheckedBaggageKg() + " kg, cabin " + trip.getCabinBaggageKg() + " kg per traveller";
    }

    private static String name(ConfirmedFlightPassenger passenger) {
        return passenger.getFirstName() + " " + passenger.getLastName();
    }

    static String money(Money money) {
        return BookingEmailComposer.format(money);
    }

    private static String issued(Instant at) {
        return "Issued " + issuedDate(at);
    }

    private static String issuedDate(Instant at) {
        return DATE_TIME.format(at.atZone(INDIA)) + " IST";
    }

    /** "2026-11-20T06:45" → "Fri, 20 Nov 2026, 06:45" (the airport's local time). */
    private static String local(String local) {
        LocalDateTime time = LocalDateTime.parse(local);
        return DATE.format(time) + ", " + time.toLocalTime();
    }

    private static String duration(int minutes) {
        return minutes / 60 + "h " + String.format("%02d", minutes % 60) + "m";
    }

    /** "PREMIUM_ECONOMY" → "Premium economy", "upi" → "Upi" (methods) */
    private static String words(String code) {
        if (code == null || code.isBlank()) {
            return "";
        }
        String text = code.replace('_', ' ').toLowerCase(Locale.ENGLISH);
        if ("upi".equals(text)) {
            return "UPI";
        }
        return Character.toUpperCase(text.charAt(0)) + text.substring(1);
    }

    private static String plural(int count, String word) {
        return plural(count, word, word + "s");
    }

    private static String plural(int count, String one, String many) {
        return count + " " + (count == 1 ? one : many);
    }

    private static String first(String value, String fallback) {
        return value != null && !value.isBlank() ? value : fallback == null ? "" : fallback;
    }
}
