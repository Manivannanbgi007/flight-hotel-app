package com.flighthotel.hotel.entity;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * Rooms held or booked for one booking of booking-service. The status only moves through the methods below, which
 * match what {@code InventoryService} did to {@code room_inventory} in the same transaction.
 */
@Getter
@Entity
@Table(name = "hotel_reservations")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class HotelReservation extends AuditableEntity {

    @Id
    private UUID id;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(name = "booking_reference", nullable = false, updatable = false, length = 20)
    private String bookingReference;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "hotel_id", nullable = false, updatable = false)
    private UUID hotelId;

    @Column(name = "room_type_id", nullable = false, updatable = false)
    private UUID roomTypeId;

    @Column(name = "rate_plan_id", nullable = false, updatable = false)
    private UUID ratePlanId;

    @Column(name = "quote_id", nullable = false, updatable = false)
    private UUID quoteId;

    @Column(name = "check_in", nullable = false, updatable = false)
    private LocalDate checkIn;

    @Column(name = "check_out", nullable = false, updatable = false)
    private LocalDate checkOut;

    @Column(nullable = false, updatable = false)
    private int rooms;

    @Column(nullable = false, updatable = false)
    private int adults;

    @Column(nullable = false, updatable = false)
    private int children;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 20)
    private ReservationStatus status;

    @Column(name = "hold_expires_at")
    private Instant holdExpiresAt;

    @Column(name = "confirmation_number", length = 20)
    private String confirmationNumber;

    @Column(nullable = false, length = 3, updatable = false)
    private String currency;

    @Column(nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal subtotal;

    @Column(nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal taxes;

    @Column(name = "total_amount", nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal totalAmount;

    @Column(name = "contact_email", nullable = false, length = 254, updatable = false)
    private String contactEmail;

    @Column(name = "contact_phone", nullable = false, length = 20, updatable = false)
    private String contactPhone;

    @Column(name = "special_requests", length = 500, updatable = false)
    private String specialRequests;

    @Column(name = "confirmed_at")
    private Instant confirmedAt;

    @Column(name = "checked_in_at")
    private Instant checkedInAt;

    @Column(name = "checked_out_at")
    private Instant checkedOutAt;

    @Column(name = "no_show_at")
    private Instant noShowAt;

    @Column(name = "released_at")
    private Instant releasedAt;

    @Column(name = "release_reason", length = 30)
    private String releaseReason;

    @Column(name = "cancellation_id")
    private UUID cancellationId;

    @Column(name = "cancellation_reference", length = 20)
    private String cancellationReference;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "cancelled_by", length = 10)
    private CancelledBy cancelledBy;

    @Column(name = "cancellation_reason", length = 300)
    private String cancellationReason;

    @ElementCollection
    @CollectionTable(name = "hotel_reservation_guests", joinColumns = @JoinColumn(name = "reservation_id"))
    @OrderBy("roomNo")
    private List<ReservationGuest> guests = new ArrayList<>();

    @Version
    private Long version;

    /** A new hold; the rooms must already be held in {@code room_inventory}. */
    public static HotelReservation hold(Stay stay, Party party, Price price, Contact contact, Instant holdExpiresAt) {
        HotelReservation reservation = new HotelReservation();
        reservation.id = UuidV7.generate();
        reservation.bookingId = stay.bookingId();
        reservation.bookingReference = stay.bookingReference();
        reservation.userId = stay.userId();
        reservation.hotelId = stay.hotelId();
        reservation.roomTypeId = stay.roomTypeId();
        reservation.ratePlanId = stay.ratePlanId();
        reservation.quoteId = stay.quoteId();
        reservation.checkIn = stay.checkIn();
        reservation.checkOut = stay.checkOut();
        reservation.rooms = party.rooms();
        reservation.adults = party.adults();
        reservation.children = party.children();
        reservation.currency = price.currency();
        reservation.subtotal = price.subtotal();
        reservation.taxes = price.taxes();
        reservation.totalAmount = price.total();
        reservation.contactEmail = contact.email();
        reservation.contactPhone = contact.phone();
        reservation.specialRequests = contact.specialRequests();
        reservation.guests.addAll(party.guests());
        reservation.status = ReservationStatus.HELD;
        reservation.holdExpiresAt = holdExpiresAt;
        return reservation;
    }

    public boolean isHeld() {
        return status == ReservationStatus.HELD;
    }

    /** Held (or re-held) rooms are now booked. */
    public void confirm(String number, Instant now) {
        requireStatus(ReservationStatus.HELD);
        status = ReservationStatus.CONFIRMED;
        confirmationNumber = number;
        confirmedAt = now;
        holdExpiresAt = null;
    }

    /** The hold ran out without payment. */
    public void expire(Instant now) {
        requireStatus(ReservationStatus.HELD);
        status = ReservationStatus.EXPIRED;
        releasedAt = now;
        releaseReason = "EXPIRED";
    }

    /** booking-service gave up on the booking. */
    public void release(String reason, Instant now) {
        requireStatus(ReservationStatus.HELD);
        status = ReservationStatus.RELEASED;
        releasedAt = now;
        releaseReason = reason;
    }

    /** The customer cancelled the confirmed stay; the caller has given the booked rooms back. */
    public void cancel(UUID cancellationId, String reference, Instant now) {
        requireStatus(ReservationStatus.CONFIRMED);
        status = ReservationStatus.CANCELLED;
        this.cancellationId = cancellationId;
        this.cancellationReference = reference;
        this.cancelledAt = now;
        this.cancelledBy = CancelledBy.CUSTOMER;
    }

    /**
     * The hotel cancelled the confirmed stay on its own (the caller has given the booked rooms back).
     * {@code cancellationId} is made by hotel-service, as there is no customer request to answer.
     */
    public void cancelByHotel(UUID cancellationId, String reference, String reason, Instant now) {
        requireStatus(ReservationStatus.CONFIRMED);
        status = ReservationStatus.CANCELLED;
        this.cancellationId = cancellationId;
        this.cancellationReference = reference;
        this.cancelledAt = now;
        this.cancelledBy = CancelledBy.HOTEL;
        this.cancellationReason = reason;
    }

    public boolean isCancelled() {
        return status == ReservationStatus.CANCELLED;
    }

    /** The guests arrived. */
    public void checkIn(Instant now) {
        requireStatus(ReservationStatus.CONFIRMED);
        status = ReservationStatus.CHECKED_IN;
        checkedInAt = now;
    }

    /** The guests left (possibly before the booked check-out date): the stay is completed. */
    public void checkOut(Instant now) {
        requireStatus(ReservationStatus.CHECKED_IN);
        status = ReservationStatus.CHECKED_OUT;
        checkedOutAt = now;
    }

    /** The guests never arrived. */
    public void markNoShow(Instant now) {
        requireStatus(ReservationStatus.CONFIRMED);
        status = ReservationStatus.NO_SHOW;
        noShowAt = now;
    }

    public int nights() {
        return (int) ChronoUnit.DAYS.between(checkIn, checkOut);
    }

    /** The guest named for room 1 (the arrival list's lead guest), if any. */
    public Optional<ReservationGuest> leadGuest() {
        return guests.stream().filter(guest -> guest.getRoomNo() == 1).findFirst()
                .or(() -> guests.stream().findFirst());
    }

    /** Payment arrived after the hold ran out, and the same rooms could be taken again. */
    public void reHold(Instant now) {
        if (status != ReservationStatus.EXPIRED && status != ReservationStatus.RELEASED) {
            throw new IllegalStateException("Only an expired or released reservation can be held again: " + status);
        }
        status = ReservationStatus.HELD;
        holdExpiresAt = now;
        releasedAt = null;
        releaseReason = null;
    }

    private void requireStatus(ReservationStatus expected) {
        if (status != expected) {
            throw new IllegalStateException("Reservation " + id + " is " + status + ", expected " + expected);
        }
    }

    public record Stay(UUID bookingId, String bookingReference, UUID userId, UUID hotelId, UUID roomTypeId,
                       UUID ratePlanId, UUID quoteId, LocalDate checkIn, LocalDate checkOut) {
    }

    public record Party(int rooms, int adults, int children, List<ReservationGuest> guests) {
    }

    public record Price(BigDecimal subtotal, BigDecimal taxes, BigDecimal total, String currency) {
    }

    public record Contact(String email, String phone, String specialRequests) {
    }
}
