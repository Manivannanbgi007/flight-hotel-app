package com.flighthotel.flight.integration;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * The provider-neutral flight model (SUPPLIER_INTEGRATION.md section 2). Booking logic and the REST API only use
 * these types; a provider maps its own formats to them inside its adapter. Amounts are rupees, times are local to the
 * airport ({@code yyyy-MM-dd'T'HH:mm}).
 */
public final class FlightModel {

    private FlightModel() {
    }

    public record Airport(String iataCode, String name, String city, String countryCode) {
    }

    public record Airline(String code, String name) {
    }

    public record Segment(String flightNumber, String airlineCode, String airlineName, String origin,
            String destination, String departureLocal, String arrivalLocal, int durationMinutes) {
    }

    public record Fare(String name, String type, boolean refundable, int checkedBaggageKg, int cabinBaggageKg,
            int cancellationFeePercent, String cancellationPolicy) {
    }

    public record Passengers(int adults, int children, int infants) {

        /** Infants sit on a lap: only adults and children need a seat. */
        public int seats() {
            return adults + children;
        }

        public int total() {
            return adults + children + infants;
        }
    }

    /** One bookable flight with one fare, as shown in the results. */
    public record FlightOption(String offerId, String provider, boolean demo, Airline airline, String flightNumber,
            Airport origin, Airport destination, String departureLocal, String arrivalLocal, int durationMinutes,
            int stops, String viaAirport, List<Segment> segments, String cabin, Fare fare, int seatsLeft,
            BigDecimal pricePerAdult, BigDecimal totalPrice, String currency, Instant expiresAt) {
    }

    /** What the provider needs to find the same flight and fare again (revalidate, hold, order). */
    public record OptionRef(String scheduleId, LocalDate date, String cabin, String fareType) {
    }

    /** An option together with its reference and the passengers it was priced for (kept in Redis). */
    public record StoredOption(FlightOption option, OptionRef ref, Passengers passengers) {
    }

    public record PriceLine(String label, BigDecimal amount) {
    }

    public record Price(List<PriceLine> lines, BigDecimal subtotal, BigDecimal taxes, BigDecimal total,
            BigDecimal perAdult) {
    }

    /** Today's price and seats for an {@link OptionRef}. */
    public record Quote(Price price, int seatsLeft) {
    }

    public record SearchCriteria(String origin, String destination, LocalDate date, Passengers passengers,
            String cabin) {
    }

    /** Seats of one flight on one date in one cabin. */
    public record SeatRequest(String scheduleId, LocalDate date, String cabin, int seats) {
    }

    public record OrderPassenger(int passengerNo, String passengerType, String firstName, String lastName) {
    }

    /** {@code pricing}: what the airline sells the order for (fare = base fares; the cancellation fee is a share of it). */
    public record OrderRequest(String idempotencyKey, List<OrderPassenger> passengers, List<SeatRequest> seats,
            OrderPricing pricing) {
    }

    public record OrderPricing(BigDecimal fareAmount, BigDecimal totalAmount, String currency, int cancelFeePercent) {
    }

    /** The airline cancelled an order: {@code penalty} is its cancellation fee, {@code refund} what it gives back. */
    public record SupplierCancellation(String cancellationRef, BigDecimal penalty, BigDecimal refund, String currency,
            java.time.Instant cancelledAt) {
    }

    public record SupplierOrder(String supplierOrderId, String pnr, List<Ticket> tickets) {
    }

    public record Ticket(int passengerNo, String ticketNumber) {
    }

    public record ProviderInfo(String code, String name, boolean demo, boolean supportsHold) {
    }

    /** Normalized supplier errors (SUPPLIER_INTEGRATION.md section 3). */
    public static class SupplierException extends RuntimeException {

        private final String code;

        public SupplierException(String code, String message) {
            super(message);
            this.code = code;
        }

        public String getCode() {
            return code;
        }
    }

    /** The supplier answered "no" (rejected the order or the cancellation): nothing changed there. */
    public static class SupplierRejectedException extends SupplierException {

        public SupplierRejectedException(String message) {
            super("SUPPLIER_REJECTED", message);
        }

        public SupplierRejectedException(String code, String message) {
            super(code, message);
        }
    }

    /** No answer in time: the order may or may not exist. Never retried blindly; reconciled by looking it up. */
    public static class SupplierTimeoutException extends SupplierException {

        public SupplierTimeoutException(String message) {
            super("SUPPLIER_TIMEOUT", message);
        }
    }

    public static class SoldOutException extends SupplierException {

        public SoldOutException() {
            super("SOLD_OUT", "Not enough seats left on this flight.");
        }
    }
}
