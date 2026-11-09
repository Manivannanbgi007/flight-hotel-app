package com.flighthotel.notification.email;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.springframework.stereotype.Component;
import org.thymeleaf.ITemplateEngine;
import org.thymeleaf.context.Context;

import com.flighthotel.common.events.EventMoney;
import com.flighthotel.common.settings.SystemSettings;
import com.flighthotel.common.text.IndianDigits;
import com.flighthotel.events.booking.BookingAwaitingPayment;
import com.flighthotel.events.booking.BookingCancellationFailed;
import com.flighthotel.events.booking.BookingCancelled;
import com.flighthotel.events.booking.BookingConfirmed;
import com.flighthotel.events.booking.BookingRefundRequested;
import com.flighthotel.events.payment.RefundCompleted;
import com.flighthotel.events.payment.PaymentSucceeded;
import com.flighthotel.events.booking.ConfirmedFlightPassenger;
import com.flighthotel.events.booking.ConfirmedFlightTrip;
import com.flighthotel.events.booking.ConfirmedHotelStay;
import com.flighthotel.events.common.FlightSegmentInfo;
import com.flighthotel.events.common.FlightSlice;
import com.flighthotel.events.common.Money;

/**
 * Builds the booking emails (confirmation, cancellation, cancellation refused, refund started). One HTML layout ({@code templates/email/booking.html})
 * and a plain-text twin. Every value is escaped by Thymeleaf; the booking page link points to the web app.
 */
@Component
public class BookingEmailComposer {

    static final String TEMPLATE = "email/booking";
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("EEE, d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH);

    private final ITemplateEngine templateEngine;
    private final SystemSettings settings;
    private final EmailProperties properties;

    public BookingEmailComposer(ITemplateEngine templateEngine, SystemSettings settings, EmailProperties properties) {
        this.templateEngine = templateEngine;
        this.settings = settings;
        this.properties = properties;
    }

    public record Row(String label, String value) {
    }

    public EmailContent confirmation(BookingConfirmed confirmed) {
        ConfirmedHotelStay hotel = confirmed.getHotel();
        List<Row> rows = new ArrayList<>();
        rows.add(new Row("Booking reference", confirmed.getBookingReference()));
        String heading = "Your booking is confirmed";
        List<String> paragraphs = List.of("Good news: your booking is confirmed and paid. Keep this email for your trip.");
        if (hotel != null) {
            rows.add(new Row("Hotel", hotel.getHotelName() + ", " + hotel.getHotelCity()));
            rows.add(new Row("Address", hotel.getHotelAddress()));
            rows.add(new Row("Room", hotel.getRoomTypeName() + " · " + hotel.getRatePlanName()));
            rows.add(new Row("Check-in", hotel.getCheckIn().format(DATE) + ", from " + hotel.getCheckInTime()));
            rows.add(new Row("Check-out", hotel.getCheckOut().format(DATE) + ", until " + hotel.getCheckOutTime()));
            rows.add(new Row("Stay", hotel.getNights() + (hotel.getNights() == 1 ? " night" : " nights") + ", "
                    + hotel.getRooms() + (hotel.getRooms() == 1 ? " room" : " rooms") + ", " + hotel.getAdults()
                    + (hotel.getAdults() == 1 ? " adult" : " adults")
                    + (hotel.getChildren() > 0 ? ", " + hotel.getChildren() + " children" : "")));
            rows.add(new Row("Hotel confirmation no.", hotel.getConfirmationNumber()));
        }
        ConfirmedFlightTrip flight = confirmed.getFlight();
        if (flight != null) {
            addFlightRows(rows, flight);
        }
        if (EventMoney.amount(confirmed.getDiscountAmount()).signum() > 0) {
            rows.add(new Row("Discount", "-" + format(confirmed.getDiscountAmount())));
        }
        rows.add(new Row("Total paid", format(confirmed.getTotalAmount())));
        if (hotel != null) {
            rows.add(new Row("Cancellation", hotel.getCancellationPolicy()));
        }
        if (flight != null) {
            rows.add(new Row("Cancellation", flight.getCancellationPolicy()));
        }
        String footnote = hotel != null && hotel.getDemo()
                ? "This is a demo booking with sample hotel data. No real room is reserved."
                : flight != null && flight.getDemo()
                        ? "This is a demo booking with sample flight data. It is not a real ticket." : null;
        return render("Booking confirmed " + confirmed.getBookingReference(), heading, confirmed.getCustomerName(),
                paragraphs, rows, "View booking", properties.appUrl("/my-trips/" + confirmed.getBookingId()), footnote);
    }

    private static void addFlightRows(List<Row> rows, ConfirmedFlightTrip flight) {
        rows.add(new Row("Booking reference (PNR)", flight.getPnr()));
        rows.add(new Row("Trip", flight.getTitle()));
        for (FlightSlice slice : flight.getSlices()) {
            LocalDateTime departure = LocalDateTime.parse(slice.getDepartureLocal());
            LocalDateTime arrival = LocalDateTime.parse(slice.getArrivalLocal());
            FlightSegmentInfo firstSegment = slice.getSegments().getFirst();
            rows.add(new Row(departure.format(DATE) + " · " + firstSegment.getFlightNumber(),
                    slice.getOrigin() + " " + departure.format(TIME) + " to " + slice.getDestination() + " "
                            + arrival.format(TIME) + " · " + firstSegment.getAirlineName()
                            + (slice.getStops() == 0 ? " · non-stop" : " · " + slice.getStops() + " stop")));
        }
        rows.add(new Row("Cabin and fare", flight.getCabin().replace('_', ' ').toLowerCase(Locale.ENGLISH) + " · "
                + flight.getFareName()));
        rows.add(new Row("Baggage", "Checked " + flight.getCheckedBaggageKg() + " kg, cabin "
                + flight.getCabinBaggageKg() + " kg"));
        for (ConfirmedFlightPassenger passenger : flight.getPassengers()) {
            rows.add(new Row("Traveller " + passenger.getIndex(), passenger.getFirstName() + " "
                    + passenger.getLastName() + " · ticket " + passenger.getTicketNumber()));
        }
    }

    /** The hotel or airline confirmed the cancellation: what was kept and what comes back. */
    public EmailContent cancelled(BookingCancelled cancelled) {
        boolean refund = EventMoney.amount(cancelled.getRefundAmount()).signum() > 0;
        List<Row> rows = new java.util.ArrayList<>(List.of(
                new Row("Booking reference", cancelled.getBookingReference()),
                new Row("Booking", cancelled.getTitle()),
                new Row("Amount paid", format(cancelled.getPaidAmount())),
                new Row("Cancellation fee", cancelled.getFeeWaived() ? "Waived" : format(cancelled.getCancellationFee())),
                new Row("Refund", format(cancelled.getRefundAmount()))));
        if (cancelled.getSupplierReference() != null) {
            rows.add(new Row("Cancellation number", cancelled.getSupplierReference()));
        }
        String hotelOrAirline = "FLIGHT".equals(cancelled.getBookingType()) ? "airline" : "hotel";
        boolean byTheHotel = "HOTEL".equals(cancelled.getInitiatedBy());
        List<String> paragraphs = byTheHotel
                ? List.of("We are sorry: the hotel had to cancel your stay.",
                        "You pay nothing for this. We started a refund of " + format(cancelled.getRefundAmount())
                                + " to your original payment method. Banks usually take 5 to 7 working days to show it.",
                        "Our support team is happy to help you find another stay.")
                : refund
                ? List.of("The " + hotelOrAirline + " has confirmed the cancellation of your booking.",
                        "We started a refund of " + format(cancelled.getRefundAmount())
                                + " to your original payment method. Banks usually take 5 to 7 working days to show it.")
                : List.of("The " + hotelOrAirline + " has confirmed the cancellation of your booking.",
                        "Under the cancellation terms of your booking, nothing is refunded.");
        return render((byTheHotel ? "The hotel cancelled your booking " : "Booking cancelled ")
                + cancelled.getBookingReference(), byTheHotel ? "The hotel cancelled your stay" : "Your booking is cancelled",
                cancelled.getCustomerName(), paragraphs, rows, "View booking",
                properties.appUrl("/my-trips/" + cancelled.getBookingId()), null);
    }

    /** The hotel or airline refused the cancellation: the booking is still valid. */
    public EmailContent cancellationFailed(BookingCancellationFailed failed) {
        List<Row> rows = List.of(
                new Row("Booking reference", failed.getBookingReference()),
                new Row("Booking", failed.getTitle()),
                new Row("Reason", failed.getMessage()));
        return render("We could not cancel booking " + failed.getBookingReference(), "Your booking is still valid",
                failed.getCustomerName(),
                List.of("We asked to cancel your booking, but it could not be cancelled.",
                        "Nothing has changed: your booking is still valid and nothing was charged or refunded. "
                                + "Our support team has been told and will contact you if needed."),
                rows, "View booking", properties.appUrl("/my-trips/" + failed.getBookingId()), null);
    }

    // ------------------------------------------------------------------ Phase 8

    /** Rooms or seats held: the customer must pay before the deadline. */
    public EmailContent bookingReceived(BookingAwaitingPayment awaiting) {
        List<Row> rows = List.of(
                new Row("Booking reference", awaiting.getBookingReference()),
                new Row("Booking", awaiting.getDescription()),
                new Row("Amount to pay", format(awaiting.getAmount())),
                new Row("Pay before", INDIA_TIME.format(awaiting.getPaymentDeadline().atZone(INDIA)) + " IST"));
        return render("Complete your payment " + awaiting.getBookingReference(), "Booking received: complete your payment",
                awaiting.getContactEmail(),
                List.of("We are holding your booking for you. It is confirmed once you have paid and the hotel or "
                        + "airline has confirmed it.", "If you do not pay in time, the booking is released."),
                rows, "Pay now", properties.appUrl("/my-trips/" + awaiting.getBookingId() + "/pay"), null);
    }

    public EmailContent paymentReceived(PaymentSucceeded payment, String reference, String description, String name) {
        List<Row> rows = new ArrayList<>();
        rows.add(new Row("Booking reference", reference));
        if (description != null) {
            rows.add(new Row("Booking", description));
        }
        rows.add(new Row("Amount paid", format(payment.getAmount())));
        rows.add(new Row("Payment ID", payment.getPaymentId()));
        return render("Payment received " + reference, "Payment received", name,
                List.of("Thank you, we received your payment. We are now confirming your booking with the hotel or "
                        + "airline and will e-mail you as soon as it is confirmed.",
                        "Your payment receipt is attached."),
                rows, "View booking", properties.appUrl("/my-trips/" + payment.getBookingId()), null);
    }

    public EmailContent paymentFailed(String bookingId, String reference, String reason, String name) {
        return render("Your payment did not go through " + reference, "Your payment did not go through", name,
                List.of("Your payment for booking " + reference + " was not completed" + (reason == null ? "."
                        : ": " + reason + "."), "Nothing was charged. You can try again before the booking expires."),
                List.of(new Row("Booking reference", reference)), "Try again",
                properties.appUrl("/my-trips/" + bookingId + "/pay"), null);
    }

    public EmailContent refundCompleted(RefundCompleted refund, String reference, String name) {
        return render("Refund completed " + reference, "Your refund is complete", name,
                List.of("We returned " + format(refund.getAmount()) + " to your original payment method. Banks usually "
                        + "take 5 to 7 working days to show it.", "Your refund receipt is attached."),
                List.of(new Row("Booking reference", reference), new Row("Refund amount", format(refund.getAmount())),
                        new Row("Refund ID", refund.getRefundId())),
                "View booking", properties.appUrl("/my-trips/" + refund.getBookingId()), null);
    }

    /** 24 hours before check-in or departure. */
    public EmailContent travelReminder(String bookingId, String reference, String bookingType, String title,
            String name, List<Row> details) {
        boolean flight = "FLIGHT".equals(bookingType);
        List<Row> rows = new ArrayList<>();
        rows.add(new Row("Booking reference", reference));
        rows.addAll(details);
        return render((flight ? "Your flight is tomorrow: " : "Your stay starts tomorrow: ") + title,
                flight ? "Your flight is tomorrow" : "Your stay starts tomorrow", name,
                List.of(flight ? "Have a good trip! Check in with the airline in time and carry a photo ID that "
                                + "matches your ticket."
                                : "We hope you enjoy your stay. Show your confirmation and a photo ID at check-in.",
                        "Your documents are in your booking."),
                rows, "View booking", properties.appUrl("/my-trips/" + bookingId), null);
    }

    /** Support answered a ticket; the answer itself is only shown in the account (it may contain personal details). */
    public EmailContent ticketAnswered(String ticketId, String ticketNumber, String subject) {
        return render("New reply on your support ticket " + ticketNumber, "Our support team answered you", "there",
                List.of("We replied to your support ticket “" + subject + "”.",
                        "Please read the answer and reply in your account if you need anything else."),
                List.of(new Row("Ticket", ticketNumber)), "Read the reply",
                properties.appUrl("/account/support/" + ticketId), null);
    }

    public EmailContent newsletterConfirmation(String confirmUrl) {
        return render("Please confirm your newsletter subscription", "Confirm your subscription", "there",
                List.of("Someone, hopefully you, asked to receive our newsletter at this address.",
                        "Please confirm with the button below. The link works for 48 hours. If it was not you, just "
                                + "ignore this e-mail: nothing will be sent."),
                List.of(), "Confirm subscription", confirmUrl, null);
    }

    public EmailContent newsletterWelcome(String unsubscribeUrl) {
        return render("You are subscribed to our newsletter", "You are subscribed", "there",
                List.of("Thanks for subscribing. We will send you travel ideas and offers now and then."),
                List.of(), "Visit us", properties.appUrl("/"),
                "Don't want these e-mails any more? Unsubscribe: " + unsubscribeUrl);
    }

    public EmailContent refundStarted(BookingRefundRequested refund) {
        List<Row> rows = List.of(
                new Row("Booking reference", refund.getBookingReference()),
                new Row("Refund amount", format(refund.getAmount())),
                new Row("Reason", reason(refund.getReason())));
        return render("Your refund is on its way " + refund.getBookingReference(), "Your refund is on its way",
                refund.getCustomerName(),
                List.of("We started a refund to your original payment method.",
                        "Banks usually take 5 to 7 working days to show it."),
                rows, "View booking", properties.appUrl("/my-trips/" + refund.getBookingId()), null);
    }

    static String reason(String code) {
        return switch (code) {
            case "BOOKING_FAILED" -> "The hotel could not confirm your booking";
            case "LATE_PAYMENT" -> "The payment arrived after the booking had expired";
            case "DUPLICATE_PAYMENT" -> "A second payment was received for the same booking";
            case "CANCELLATION" -> "Booking cancelled";
            case "GOODWILL" -> "A goodwill refund from our team";
            default -> "Refund";
        };
    }

    private static final java.time.ZoneId INDIA = java.time.ZoneId.of("Asia/Kolkata");
    private static final java.time.format.DateTimeFormatter INDIA_TIME =
            java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.ENGLISH);

    /** "₹2,625.00" for rupees, "USD 10.00" for everything else. */
    public static String format(Money money) {
        return format(EventMoney.amount(money), money.getCurrency());
    }

    public static String format(BigDecimal amount, String currency) {
        NumberFormat number = NumberFormat.getNumberInstance(Locale.of("en", "IN"));
        number.setMinimumFractionDigits(2);
        number.setMaximumFractionDigits(2);
        // The JDK groups en-IN like en-US (200,000.00); Indian grouping is added here.
        number.setGroupingUsed(false);
        String text = IndianDigits.group(number.format(amount));
        return "INR".equals(currency) ? "₹" + text : currency + " " + text;
    }

    private EmailContent render(String subject, String heading, String customerName, List<String> paragraphs,
            List<Row> rows, String actionLabel, String actionUrl, String footnote) {
        String site = settings.getString("site.name", "FlightHotel");
        String support = settings.getString("support.email", "support@flighthotel.local");
        Context context = new Context(Locale.ENGLISH);
        context.setVariable("siteName", site);
        context.setVariable("supportEmail", support);
        context.setVariable("heading", heading);
        context.setVariable("customerName", customerName);
        context.setVariable("paragraphs", paragraphs);
        context.setVariable("rows", rows);
        context.setVariable("actionLabel", actionLabel);
        context.setVariable("actionUrl", actionUrl);
        context.setVariable("footnote", footnote);
        String html = templateEngine.process(TEMPLATE, context);

        StringBuilder text = new StringBuilder("Hello ").append(customerName).append(",\n\n");
        paragraphs.forEach(paragraph -> text.append(paragraph).append("\n\n"));
        rows.forEach(row -> text.append(row.label()).append(": ").append(row.value()).append('\n'));
        text.append('\n').append(actionLabel).append(": ").append(actionUrl).append("\n\n");
        if (footnote != null) {
            text.append(footnote).append("\n\n");
        }
        text.append(site).append(" · ").append(support).append('\n');
        return new EmailContent(subject, html, text.toString());
    }
}
