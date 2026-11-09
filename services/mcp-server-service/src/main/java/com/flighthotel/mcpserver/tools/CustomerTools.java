package com.flighthotel.mcpserver.tools;

import static com.flighthotel.common.security.Roles.ADMIN;
import static com.flighthotel.common.security.Roles.CUSTOMER;
import static com.flighthotel.common.security.Roles.SUPPORT_AGENT;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.flighthotel.mcpserver.gateway.GatewayClient;
import com.flighthotel.mcpserver.security.Caller;

import tools.jackson.databind.JsonNode;

/**
 * The customer's own data: trips, one booking, the cancellation quote, payments, support tickets, notifications.
 * {@code booking_details} and {@code cancellation_quote} are also offered to support agents and admins, who may read
 * any booking ({@code BOOKING_READ_ANY}).
 */
@Component
public class CustomerTools implements ToolSet {

    private final GatewayClient gateway;
    private final BookingLookup bookings;

    public CustomerTools(GatewayClient gateway, BookingLookup bookings) {
        this.gateway = gateway;
        this.bookings = bookings;
    }

    @Override
    public List<ToolDefinition> tools() {
        return List.of(myBookings(), bookingDetails(), cancellationQuote(), tripSummary(), myPayments(),
                myTickets(), myNotifications());
    }

    private ToolDefinition myBookings() {
        return ToolDefinition.named("my_bookings")
                .title("Your trips")
                .description("List the signed-in customer's bookings (hotel stays and flights), newest first. "
                        + "tab UPCOMING = confirmed trips still ahead.")
                .roles(CUSTOMER)
                .param(Param.oneOf("tab", "Which trips (default ALL)",
                        List.of("ALL", "UPCOMING", "PENDING", "COMPLETED", "CANCELLED")))
                .param(Param.integer("limit", "Maximum rows (default 10)", 1, 20))
                .handler((args, caller) -> {
                    JsonNode page = gateway.get(caller, "/api/bookings",
                            Map.of("tab", args.text("tab", "ALL"), "size", args.integer("limit", 10)));
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("tab", args.text("tab", "ALL"));
                    out.put("count", Out.total(page));
                    out.put("bookings", Out.rows(Out.content(page), args.integer("limit", 10), CustomerTools::row));
                    return out;
                });
    }

    static Map<String, Object> row(JsonNode row) {
        Map<String, Object> out = Out.pick(row, "reference", "type", "status", "paymentStatus", "title",
                "destination", "startDate", "endDate");
        Out.money(out, "total", row, "totalAmount", Out.currency(row));
        Out.put(out, "contactEmail", Out.text(row, "contactEmail"));
        Out.put(out, "leadName", Out.text(row, "leadName"));
        Out.put(out, "needsAttention", Out.text(row, "attentionReason"));
        return out;
    }

    private ToolDefinition bookingDetails() {
        return ToolDefinition.named("booking_details")
                .title("Booking details")
                .description("Details of one booking by its reference: status, dates, hotel or flight, price, "
                        + "PNR or hotel confirmation number, cancellation and refunds.")
                .roles(CUSTOMER, SUPPORT_AGENT, ADMIN)
                .param(BookingLookup.referenceParam())
                .handler((args, caller) -> details(bookings.details(caller, args.text("reference")), caller));
    }

    static Map<String, Object> details(JsonNode booking, Caller caller) {
        return details(booking, caller, java.time.Instant.now());
    }

    static Map<String, Object> details(JsonNode booking, Caller caller, java.time.Instant now) {
        String currency = Out.currency(booking);
        Map<String, Object> out = Out.pick(booking, "reference", "type", "status", "paymentStatus", "title",
                "destination", "startDate", "endDate", "createdAt", "confirmedAt", "failureReason", "canPay",
                "canCancel", "paymentDeadline", "couponCode");
        Map<String, Object> price = new LinkedHashMap<>();
        Out.money(price, "total", booking, "totalAmount", currency);
        Out.money(price, "base", booking, "baseAmount", currency);
        Out.money(price, "taxes", booking, "taxAmount", currency);
        Out.money(price, "fees", booking, "feeAmount", currency);
        if (booking.path("discountAmount").isNumber() && booking.path("discountAmount").decimalValue().signum() != 0) {
            Out.money(price, "discount", booking, "discountAmount", currency);
        }
        if (booking.path("refundedAmount").isNumber() && booking.path("refundedAmount").decimalValue().signum() != 0) {
            Out.money(price, "refunded", booking, "refundedAmount", currency);
        }
        Out.put(out, "price", price);

        JsonNode hotel = booking.get("hotel");
        if (hotel != null && hotel.isObject()) {
            Map<String, Object> stay = Out.pick(hotel, "hotelName", "city", "address", "roomTypeName", "ratePlanName",
                    "breakfastIncluded", "checkIn", "checkOut", "checkInTime", "checkOutTime", "nights", "rooms",
                    "adults", "children", "confirmationNumber");
            JsonNode terms = hotel.get("cancellation");
            if (terms != null && terms.isObject()) {
                Object refundable = Out.scalar(terms.get("refundable"));
                Out.put(stay, "refundable", refundable);
                // A past deadline (or one of a non-refundable rate) only confuses the model: leave it out.
                if (!Boolean.FALSE.equals(refundable)) {
                    Out.put(stay, "freeCancellationUntil", Out.future(Out.text(terms, "freeCancellationUntil"), now));
                }
                Out.put(stay, "cancellationPolicy", Out.shorten(Out.text(terms, "policy"), 240));
            }
            out.put("hotel", stay);
        }
        JsonNode flight = booking.get("flight");
        if (flight != null && flight.isObject()) {
            Map<String, Object> trip = Out.pick(flight, "pnr", "tripType", "cabin", "fareName", "refundable",
                    "checkedBaggageKg", "cabinBaggageKg", "adults", "children", "infants");
            List<Map<String, Object>> slices = new ArrayList<>();
            for (JsonNode slice : flight.path("slices")) {
                Map<String, Object> view = Out.pick(slice, "originCity", "origin", "destinationCity", "destination",
                        "departureLocal", "arrivalLocal", "durationMinutes", "stops");
                List<String> numbers = new ArrayList<>();
                for (JsonNode segment : slice.path("segments")) {
                    numbers.add(Out.text(segment, "flightNumber") + " (" + Out.text(segment, "airlineName") + ")");
                }
                Out.put(view, "flights", numbers);
                slices.add(view);
            }
            Out.put(trip, "slices", slices);
            List<Map<String, Object>> passengers = new ArrayList<>();
            for (JsonNode passenger : flight.path("passengers")) {
                Map<String, Object> view = new LinkedHashMap<>();
                view.put("name", Out.text(passenger, "firstName") + " " + Out.text(passenger, "lastName"));
                Out.put(view, "type", Out.text(passenger, "passengerType"));
                Out.put(view, "passport", Out.maskPassport(Out.text(passenger, "passportLast4")));
                Out.put(view, "ticketNumber", Out.text(passenger, "ticketNumber"));
                passengers.add(view);
            }
            Out.put(trip, "passengers", passengers);
            Out.put(trip, "cancellationPolicy", Out.shorten(Out.text(flight, "cancellationPolicy"), 240));
            out.put("flight", trip);
        }
        JsonNode cancellation = booking.get("cancellation");
        if (cancellation != null && cancellation.isObject()) {
            Map<String, Object> view = Out.pick(cancellation, "status", "initiatedBy", "requestedAt", "completedAt");
            Out.money(view, "cancellationFee", cancellation, "cancellationFee", currency);
            Out.money(view, "refundAmount", cancellation, "refundAmount", currency);
            Out.put(view, "failureMessage", Out.shorten(Out.text(cancellation, "failureMessage"), 200));
            out.put("cancellation", view);
        }
        List<Map<String, Object>> refunds = Out.rows(booking.path("refunds"), 5, refund -> {
            Map<String, Object> view = Out.pick(refund, "status", "reason", "requestedAt", "completedAt");
            Out.money(view, "amount", refund, "amount", currency);
            return view;
        });
        Out.put(out, "refunds", refunds);
        if (caller.user().hasPermission("BOOKING_READ_ANY")) {
            Out.put(out, "contactEmail", Out.text(booking, "contactEmail"));
            JsonNode attention = booking.get("attention");
            if (attention != null && attention.isObject()) {
                out.put("needsAttention", Out.pick(attention, "reason", "since"));
            }
        }
        return out;
    }

    private ToolDefinition cancellationQuote() {
        return ToolDefinition.named("cancellation_quote")
                .title("Cancellation quote")
                .description("What cancelling a booking would cost now: fee and refund amount, deadlines and policy. "
                        + "Read only: it never cancels.")
                .roles(CUSTOMER, SUPPORT_AGENT, ADMIN)
                .param(BookingLookup.referenceParam())
                .handler((args, caller) -> {
                    String reference = args.text("reference");
                    String id = bookings.idOf(caller, reference);
                    JsonNode quote = gateway.get(caller, "/api/bookings/{id}/cancellation-quote", Map.of("id", id),
                            Map.of());
                    String currency = Out.currency(quote);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("reference", reference);
                    out.putAll(Out.pick(quote, "cancellable", "reasonCode", "message", "freeCancellation",
                            "cancelUntil", "feeDescription", "quotedAt"));
                    Out.put(out, "freeCancellationUntil", Out.future(Out.text(quote, "freeCancellationUntil"),
                            java.time.Instant.now()));
                    Out.money(out, "paid", quote, "paidAmount", currency);
                    Out.money(out, "cancellationFee", quote, "cancellationFee", currency);
                    Out.money(out, "refund", quote, "refundAmount", currency);
                    Out.put(out, "policy", Out.shorten(Out.text(quote, "policy"), 300));
                    out.put("howToCancel", "Only on the booking page (My Trips), which shows this quote and asks "
                            + "for confirmation. The assistant cannot cancel.");
                    return out;
                });
    }

    private ToolDefinition tripSummary() {
        return ToolDefinition.named("my_trip_summary")
                .title("Your travel summary")
                .description("Totals for the signed-in customer: hotel and flight bookings, upcoming, completed "
                        + "and cancelled trips, money paid and refunded in a period, and the next trip.")
                .roles(CUSTOMER)
                .param(Param.oneOf("range", "Period of the totals (default LAST_12_MONTHS; ALL_TIME = since the "
                        + "first booking)", List.of("THIS_MONTH", "PREVIOUS_MONTH", "THIS_YEAR", "PREVIOUS_YEAR",
                        "LAST_30_DAYS", "LAST_90_DAYS", "LAST_12_MONTHS", "ALL_TIME")))
                .handler((args, caller) -> {
                    Map<String, Object> query = new LinkedHashMap<>();
                    query.put("range", args.text("range"));
                    JsonNode summary = gateway.get(caller, "/api/bookings/summary", query);
                    return summary(summary);
                });
    }

    static Map<String, Object> summary(JsonNode summary) {
        Map<String, Object> out = new LinkedHashMap<>();
        Out.put(out, "range", Out.pick(summary.path("range"), "preset", "from", "to"));
        Out.put(out, "bookings", Out.pick(summary.path("bookings"), "total", "hotel", "flight", "upcoming",
                "completed", "cancelled"));
        Out.put(out, "trips", Out.pick(summary.path("trips"), "upcoming", "completed", "cancelled", "pending"));
        JsonNode spending = summary.path("spending");
        if (spending.isObject()) {
            String currency = Out.currency(spending);
            Map<String, Object> money = new LinkedHashMap<>();
            Out.money(money, "paid", spending, "paid", currency);
            Out.money(money, "refunded", spending, "refunded", currency);
            Out.money(money, "net", spending, "net", currency);
            Out.money(money, "refundsInProgress", spending, "refundsInProgress", currency);
            out.put("spending", money);
        }
        JsonNode next = summary.path("nextTrip");
        if (next.isObject()) {
            Map<String, Object> trip = Out.pick(next, "reference", "type", "status", "title", "destination",
                    "startDate", "endDate", "daysUntil", "inProgress");
            Out.money(trip, "total", next, "totalAmount", Out.currency(next));
            JsonNode hotel = next.path("hotel");
            if (hotel.isObject()) {
                Out.put(trip, "hotel", Out.pick(hotel, "hotelName", "city", "checkIn", "checkOut", "checkInTime",
                        "confirmationNumber"));
            }
            JsonNode flight = next.path("flight");
            if (flight.isObject()) {
                Out.put(trip, "flight", Out.pick(flight, "originCity", "destinationCity", "departureLocal",
                        "airlineName", "flightNumber", "pnr"));
            }
            out.put("nextTrip", trip);
        } else {
            out.put("nextTrip", null);
        }
        return out;
    }

    private ToolDefinition myPayments() {
        return ToolDefinition.named("my_payments")
                .title("Your payments")
                .description("The signed-in customer's payment history, newest first: booking, amount, refunded "
                        + "amount, status, method, invoice number.")
                .roles(CUSTOMER)
                .param(Param.integer("limit", "Maximum rows (default 10)", 1, 20))
                .handler((args, caller) -> {
                    int limit = args.integer("limit", 10);
                    JsonNode page = gateway.get(caller, "/api/payments", Map.of("size", limit));
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("count", Out.total(page));
                    out.put("payments", Out.rows(Out.content(page), limit, CustomerTools::payment));
                    return out;
                });
    }

    static Map<String, Object> payment(JsonNode row) {
        String currency = Out.currency(row);
        Map<String, Object> out = Out.pick(row, "bookingReference", "description", "status", "method", "provider",
                "createdAt", "invoiceNumber");
        Out.money(out, "amount", row, "amount", currency);
        if (row.path("refundedAmount").isNumber() && row.path("refundedAmount").decimalValue().signum() != 0) {
            Out.money(out, "refunded", row, "refundedAmount", currency);
        }
        Out.put(out, "failure", Out.shorten(Out.text(row, "failureMessage"), 160));
        Out.put(out, "contactEmail", Out.text(row, "contactEmail"));
        return out;
    }

    private ToolDefinition myTickets() {
        return ToolDefinition.named("my_support_tickets")
                .title("Your support tickets")
                .description("The signed-in customer's support tickets, latest activity first.")
                .roles(CUSTOMER)
                .param(Param.oneOf("status", "Only tickets with this status",
                        List.of("OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "ESCALATED", "RESOLVED", "CLOSED")))
                .param(Param.integer("limit", "Maximum rows (default 10)", 1, 20))
                .handler((args, caller) -> {
                    int limit = args.integer("limit", 10);
                    Map<String, Object> query = new LinkedHashMap<>();
                    query.put("status", args.text("status"));
                    query.put("size", limit);
                    JsonNode page = gateway.get(caller, "/api/support/tickets", query);
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("count", Out.total(page));
                    out.put("tickets", Out.rows(Out.content(page), limit, CustomerTools::ticket));
                    return out;
                });
    }

    static Map<String, Object> ticket(JsonNode row) {
        return Out.pick(row, "ticketNumber", "subject", "category", "status", "priority", "bookingReference",
                "createdAt", "lastMessageAt", "lastMessageBy", "customerEmail", "assignedToMe");
    }

    private ToolDefinition myNotifications() {
        return ToolDefinition.named("my_notifications")
                .title("Your notifications")
                .description("The signed-in user's notifications (bell), newest first, and how many are unread.")
                .roles(CUSTOMER)
                .param(Param.bool("unreadOnly", "Only unread notifications"))
                .param(Param.integer("limit", "Maximum rows (default 10)", 1, 20))
                .handler((args, caller) -> {
                    int limit = args.integer("limit", 10);
                    Map<String, Object> query = new LinkedHashMap<>();
                    query.put("unreadOnly", Boolean.TRUE.equals(args.bool("unreadOnly")));
                    query.put("size", limit);
                    JsonNode page = gateway.get(caller, "/api/notifications", query);
                    JsonNode unread = gateway.get(caller, "/api/notifications/unread-count", Map.of());
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("unread", Out.scalar(unread.get("count")));
                    out.put("notifications", Out.rows(Out.content(page), limit, row -> {
                        Map<String, Object> view = Out.pick(row, "category", "title", "read", "createdAt");
                        Out.put(view, "message", Out.shorten(Out.text(row, "message"), 200));
                        return view;
                    }));
                    return out;
                });
    }
}
