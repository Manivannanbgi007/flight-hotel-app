package com.flighthotel.mcpserver.tools;

import java.util.Map;

import org.springframework.stereotype.Component;

import com.flighthotel.mcpserver.gateway.DownstreamException;
import com.flighthotel.mcpserver.gateway.GatewayClient;
import com.flighthotel.mcpserver.security.Caller;

import tools.jackson.databind.JsonNode;

/**
 * Finds a booking by its reference ({@code HT-7K3M9Q2X}) the way the user's own pages would:
 * <ul>
 * <li>customers: in their own booking list ({@code /api/bookings}), so another customer's reference is simply not
 * there;</li>
 * <li>staff with {@code BOOKING_READ_ANY}: the support lookup ({@code /api/support/bookings?q=}).</li>
 * </ul>
 * Either way the details are then read with {@code GET /api/bookings/{id}}, which checks ownership again.
 */
@Component
public class BookingLookup {

    /** Booking references: two letters, a dash, eight letters or digits. */
    public static final String REFERENCE_REGEX = "[A-Z]{2}-[A-Z0-9]{8}";
    private static final int PAGE_SIZE = 50;
    private static final int MAX_PAGES = 4;

    private final GatewayClient gateway;

    public BookingLookup(GatewayClient gateway) {
        this.gateway = gateway;
    }

    public static Param referenceParam() {
        return Param.code("reference", "Booking reference, e.g. HT-7K3M9Q2X or FL-4KD8M2PQ", REFERENCE_REGEX,
                "HT-7K3M9Q2X").required();
    }

    /** The booking's id, or a {@link ToolFailure} NOT_FOUND that reads the same for "not yours" and "no such". */
    public String idOf(Caller caller, String reference) {
        if (caller.user().hasPermission("BOOKING_READ_ANY")) {
            JsonNode page = gateway.get(caller, "/api/support/bookings", Map.of("q", reference, "size", 5));
            for (JsonNode row : Out.content(page)) {
                if (reference.equalsIgnoreCase(Out.text(row, "reference"))) {
                    return Out.text(row, "id");
                }
            }
            throw notFound(reference);
        }
        for (int page = 0; page < MAX_PAGES; page++) {
            JsonNode result = gateway.get(caller, "/api/bookings",
                    Map.of("tab", "ALL", "page", page, "size", PAGE_SIZE));
            for (JsonNode row : Out.content(result)) {
                if (reference.equalsIgnoreCase(Out.text(row, "reference"))) {
                    return Out.text(row, "id");
                }
            }
            if (Out.total(result) <= (long) (page + 1) * PAGE_SIZE) {
                break;
            }
        }
        throw notFound(reference);
    }

    public JsonNode details(Caller caller, String reference) {
        String id = idOf(caller, reference);
        try {
            return gateway.get(caller, "/api/bookings/{id}", Map.of("id", id), Map.of());
        } catch (DownstreamException ex) {
            if (ex.kind() == DownstreamException.Kind.NOT_FOUND_OR_NOT_ALLOWED) {
                throw notFound(reference);
            }
            throw ex;
        }
    }

    static ToolFailure notFound(String reference) {
        return new ToolFailure("NOT_FOUND", "No booking " + reference
                + " was found for you, or you are not allowed to see it. Check the reference on the My Trips page.");
    }
}
