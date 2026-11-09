package com.flighthotel.flight.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.id.UuidV7;
import com.flighthotel.flight.config.FlightProperties;
import com.flighthotel.flight.dto.FlightDtos.StoredTrip;
import com.flighthotel.flight.dto.FlightDtos.TripOffer;
import com.flighthotel.flight.dto.FlightDtos.TripSlice;
import com.flighthotel.flight.integration.FlightModel.FlightOption;
import com.flighthotel.flight.integration.FlightModel.OptionRef;
import com.flighthotel.flight.integration.FlightModel.Passengers;
import com.flighthotel.flight.integration.FlightModel.PriceLine;
import com.flighthotel.flight.integration.FlightModel.Quote;
import com.flighthotel.flight.integration.FlightModel.SoldOutException;
import com.flighthotel.flight.integration.FlightModel.StoredOption;
import com.flighthotel.flight.integration.FlightProviders.FlightSearchProvider;

/**
 * "Revalidate" step of the flight booking workflow: the selected flights are priced again at today's fares and the seats
 * are checked (nothing is reserved). The result is a trip offer kept in Redis for 20 minutes; booking takes only its id.
 */
@Service
public class TripService {

    private final OfferStore store;
    private final ProviderRegistry providers;
    private final FlightProperties properties;
    private final Clock clock;

    public TripService(OfferStore store, ProviderRegistry providers, FlightProperties properties, Clock clock) {
        this.store = store;
        this.providers = providers;
        this.properties = properties;
        this.clock = clock;
    }

    public TripOffer revalidate(List<String> offerIds) {
        List<StoredOption> options = new ArrayList<>();
        for (String id : offerIds) {
            options.add(store.findOption(id).orElseThrow(TripService::expired));
        }
        StoredOption first = options.getFirst();
        if (options.size() == 2) {
            StoredOption second = options.get(1);
            boolean reversed = second.option().origin().iataCode().equals(first.option().destination().iataCode())
                    && second.option().destination().iataCode().equals(first.option().origin().iataCode());
            boolean sameTrip = second.passengers().equals(first.passengers())
                    && second.ref().cabin().equals(first.ref().cabin())
                    && second.option().provider().equals(first.option().provider());
            if (!reversed || !sameTrip || second.ref().date().isBefore(first.ref().date())) {
                throw new BusinessRuleException("INVALID_OFFERS",
                        "The outbound and return flights do not belong together. Please search again.");
            }
        }
        FlightSearchProvider provider = providers.searchProvider(first.option().provider());
        Passengers passengers = first.passengers();

        List<Quote> quotes = new ArrayList<>();
        for (StoredOption option : options) {
            try {
                quotes.add(provider.quote(option.ref(), passengers));
            } catch (SoldOutException ex) {
                throw new ConflictException("SOLD_OUT", "There are not enough seats left on "
                        + option.option().flightNumber() + ". Please choose another flight.");
            }
        }

        Map<String, BigDecimal> lines = new LinkedHashMap<>();
        BigDecimal subtotal = BigDecimal.ZERO;
        BigDecimal taxes = BigDecimal.ZERO;
        for (Quote quote : quotes) {
            quote.price().lines().forEach(line -> lines.merge(line.label(), line.amount(), BigDecimal::add));
            subtotal = subtotal.add(quote.price().subtotal());
            taxes = taxes.add(quote.price().taxes());
        }
        BigDecimal total = subtotal.add(taxes);
        BigDecimal previous = options.stream().map(o -> o.option().totalPrice()).reduce(BigDecimal.ZERO,
                BigDecimal::add);

        List<TripSlice> slices = new ArrayList<>();
        for (StoredOption stored : options) {
            FlightOption o = stored.option();
            slices.add(new TripSlice(o.origin(), o.destination(), o.airline(), o.flightNumber(), o.departureLocal(),
                    o.arrivalLocal(), o.durationMinutes(), o.stops(), o.viaAirport(), o.segments(), o.fare()));
        }
        boolean international = !first.option().origin().countryCode()
                .equals(first.option().destination().countryCode());
        Instant expires = clock.instant().plus(properties.offerTtl());
        String title = first.option().origin().city() + " to " + first.option().destination().city();
        TripOffer offer = new TripOffer(UuidV7.generate().toString(), expires,
                options.size() == 2 ? "ROUND_TRIP" : "ONE_WAY", first.ref().cabin(), first.option().provider(),
                first.option().demo(), title, international, passengers, slices,
                slices.stream().allMatch(s -> s.fare().refundable()),
                slices.stream().mapToInt(s -> s.fare().checkedBaggageKg()).min().orElse(0),
                slices.stream().mapToInt(s -> s.fare().cabinBaggageKg()).min().orElse(0), policy(slices),
                lines.entrySet().stream().map(e -> new PriceLine(e.getKey(), e.getValue())).toList(), subtotal, taxes,
                total, "INR", total.compareTo(previous) != 0, total.compareTo(previous) != 0 ? previous : null);
        store.saveTrip(new StoredTrip(offer, options.stream().map(StoredOption::ref).toList()));
        return offer;
    }

    public TripOffer find(String tripOfferId) {
        return store.findTrip(tripOfferId).map(StoredTrip::offer).orElseThrow(TripService::expired);
    }

    private static String policy(List<TripSlice> slices) {
        if (slices.size() == 1) {
            return slices.getFirst().fare().cancellationPolicy();
        }
        List<String> labels = List.of("Outbound", "Return");
        List<String> parts = new ArrayList<>();
        for (int i = 0; i < slices.size(); i++) {
            parts.add(labels.get(i) + ": " + slices.get(i).fare().cancellationPolicy());
        }
        return parts.stream().collect(Collectors.joining(" "));
    }

    private static ApiException expired() {
        return new ApiException(HttpStatus.NOT_FOUND, "OFFER_EXPIRED",
                "These prices are no longer held. Please search again.");
    }
}
