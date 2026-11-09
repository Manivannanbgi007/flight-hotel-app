package com.flighthotel.booking.service;

import java.util.List;

import com.flighthotel.booking.dto.BookingDtos.SegmentView;
import com.flighthotel.booking.dto.BookingDtos.SliceView;
import com.flighthotel.events.common.FlightSegmentInfo;
import com.flighthotel.events.common.FlightSlice;

/** Converts the flights of a trip between the Avro event types and the JSON snapshot / API views. */
final class FlightMapper {

    private FlightMapper() {
    }

    static List<SliceView> views(List<FlightSlice> slices) {
        return slices.stream().map(slice -> new SliceView(slice.getOrigin(), slice.getDestination(),
                slice.getOriginCity(), slice.getDestinationCity(), slice.getDepartureLocal(), slice.getArrivalLocal(),
                slice.getDurationMinutes(), slice.getStops(), slice.getSegments().stream()
                        .map(s -> new SegmentView(s.getFlightNumber(), s.getAirlineCode(), s.getAirlineName(),
                                s.getOrigin(), s.getDestination(), s.getDepartureLocal(), s.getArrivalLocal(),
                                s.getDurationMinutes()))
                        .toList()))
                .toList();
    }

    static List<FlightSlice> avro(List<SliceView> slices) {
        return slices.stream().map(slice -> FlightSlice.newBuilder()
                .setOrigin(slice.origin())
                .setDestination(slice.destination())
                .setOriginCity(slice.originCity())
                .setDestinationCity(slice.destinationCity())
                .setDepartureLocal(slice.departureLocal())
                .setArrivalLocal(slice.arrivalLocal())
                .setDurationMinutes(slice.durationMinutes())
                .setStops(slice.stops())
                .setSegments(slice.segments().stream().map(s -> FlightSegmentInfo.newBuilder()
                        .setFlightNumber(s.flightNumber())
                        .setAirlineCode(s.airlineCode())
                        .setAirlineName(s.airlineName())
                        .setOrigin(s.origin())
                        .setDestination(s.destination())
                        .setDepartureLocal(s.departureLocal())
                        .setArrivalLocal(s.arrivalLocal())
                        .setDurationMinutes(s.durationMinutes())
                        .build()).toList())
                .build()).toList();
    }
}
