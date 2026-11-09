package com.flighthotel.booking.entity;

import java.util.UUID;

import org.springframework.data.domain.Persistable;

import com.flighthotel.events.flight.FlightOfferHeld;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * The flight part of a booking (same id as the booking). At first only the offer id and the passenger counts are known;
 * routes, fare and baggage are copied from flight-service's {@code FlightOfferHeld}, so they are exactly what was held
 * and priced. The PNR stays empty until the airline issued the booking.
 */
@Getter
@Entity
@Table(name = "flight_bookings")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class FlightBooking implements Persistable<UUID> {

    @Id
    @Column(name = "booking_id")
    private UUID bookingId;

    @Column(name = "offer_id", nullable = false, updatable = false, length = 40)
    private String offerId;

    @Column(name = "hold_id")
    private UUID holdId;

    @Column(length = 20)
    private String provider;

    @Column(name = "trip_type", length = 10)
    private String tripType;

    @Column(length = 20)
    private String cabin;

    @Column(name = "fare_name", length = 40)
    private String fareName;

    private Boolean refundable;

    @Column(name = "checked_baggage_kg")
    private Integer checkedBaggageKg;

    @Column(name = "cabin_baggage_kg")
    private Integer cabinBaggageKg;

    @Column(name = "cancellation_fee_percent")
    private Integer cancellationFeePercent;

    @Column(nullable = false, updatable = false)
    private int adults;

    @Column(nullable = false, updatable = false)
    private int children;

    @Column(nullable = false, updatable = false)
    private int infants;

    @Column(name = "slices_json", columnDefinition = "MEDIUMTEXT")
    private String slicesJson;

    @Column(length = 6)
    private String pnr;

    @Column(nullable = false)
    private boolean demo;

    public FlightBooking(UUID bookingId, String offerId, int adults, int children, int infants) {
        this.bookingId = bookingId;
        this.offerId = offerId;
        this.adults = adults;
        this.children = children;
        this.infants = infants;
    }

    public void held(FlightOfferHeld held, String slicesJson) {
        this.holdId = UUID.fromString(held.getHoldId());
        this.provider = held.getProvider();
        this.tripType = held.getTripType();
        this.cabin = held.getCabin();
        this.fareName = held.getFareName();
        this.refundable = held.getRefundable();
        this.checkedBaggageKg = held.getCheckedBaggageKg();
        this.cabinBaggageKg = held.getCabinBaggageKg();
        this.cancellationFeePercent = held.getCancellationFeePercent();
        this.slicesJson = slicesJson;
        this.demo = held.getDemo();
    }

    public void confirmed(String pnr) {
        this.pnr = pnr;
    }

    /** Ids are assigned in Java, so Spring Data must be told when a row is new (no extra SELECT before INSERT). */
    @Transient
    private boolean isNew = true;

    @Override
    public boolean isNew() {
        return isNew;
    }

    @Override
    public UUID getId() {
        return bookingId;
    }

    @PostLoad
    @PostPersist
    void markNotNew() {
        this.isNew = false;
    }
}
