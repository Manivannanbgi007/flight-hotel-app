package com.flighthotel.search.sync;

import java.util.List;

import com.flighthotel.events.common.FlightSlice;
import com.flighthotel.search.index.Fields;

/** The searchable words of a flight: cities and airlines as details, flight numbers and airport codes as identifiers. */
final class FlightTexts {

    private FlightTexts() {
    }

    static void addSlices(Fields fields, List<FlightSlice> slices) {
        if (slices == null) {
            return;
        }
        for (FlightSlice slice : slices) {
            fields.add("details", slice.getOriginCity(), slice.getDestinationCity());
            fields.add("extraIdentifiers", slice.getOrigin(), slice.getDestination());
            slice.getSegments().forEach(segment -> fields
                    .add("details", segment.getAirlineName())
                    // "6E 2134" and "6E2134": people type flight numbers both ways.
                    .add("extraIdentifiers", segment.getFlightNumber(), segment.getFlightNumber().replace(" ", "")));
        }
    }
}
