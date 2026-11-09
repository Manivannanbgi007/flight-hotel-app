package com.flighthotel.flight.integration;

import java.util.List;
import java.util.Optional;

import com.flighthotel.flight.integration.FlightModel.OptionRef;
import com.flighthotel.flight.integration.FlightModel.OrderRequest;
import com.flighthotel.flight.integration.FlightModel.Passengers;
import com.flighthotel.flight.integration.FlightModel.ProviderInfo;
import com.flighthotel.flight.integration.FlightModel.Quote;
import com.flighthotel.flight.integration.FlightModel.SearchCriteria;
import com.flighthotel.flight.integration.FlightModel.SeatRequest;
import com.flighthotel.flight.integration.FlightModel.StoredOption;
import com.flighthotel.flight.integration.FlightModel.SupplierCancellation;
import com.flighthotel.flight.integration.FlightModel.SupplierOrder;

/** The two provider interfaces of SUPPLIER_INTEGRATION.md section 2 (a real supplier adapter implements both). */
public final class FlightProviders {

    private FlightProviders() {
    }

    public interface FlightSearchProvider {

        ProviderInfo info();

        /** One direction on one date; every option is bookable with the passengers of the criteria. */
        List<StoredOption> search(SearchCriteria criteria);

        /** Today's price and seats for the same flight and fare. {@code SoldOutException} when seats are gone. */
        Quote quote(OptionRef ref, Passengers passengers);
    }

    public interface FlightBookingProvider {

        ProviderInfo info();

        /** All seats or none. */
        boolean hold(List<SeatRequest> seats);

        void release(List<SeatRequest> seats);

        /**
         * Issues the booking for held seats. Idempotent per {@code idempotencyKey}. Throws
         * {@code SupplierRejectedException} (nothing issued) or {@code SupplierTimeoutException} (unknown outcome).
         */
        SupplierOrder createOrder(OrderRequest request);

        /** The order created for this key, if the supplier has one (reconciliation). */
        Optional<SupplierOrder> findOrder(String idempotencyKey);

        /**
         * Cancels an issued order at the airline's own fee. Idempotent: an order that is already cancelled returns its
         * cancellation. Throws {@code SupplierRejectedException} (code {@code TOO_LATE}, {@code NOT_ALLOWED},
         * {@code NOT_CANCELLABLE}: nothing changed) or {@code SupplierTimeoutException} (unknown outcome: look it up
         * with {@link #findCancellation}, never cancel blindly again).
         */
        SupplierCancellation cancelOrder(String supplierOrderId, String idempotencyKey);

        /** The cancellation of this order, if the airline has one (reconciliation). */
        Optional<SupplierCancellation> findCancellation(String supplierOrderId);

        /** Throws when the supplier cannot be used right now. */
        void checkHealth();
    }
}
