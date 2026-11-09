package com.flighthotel.booking.entity;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import com.flighthotel.events.hotel.HotelInventoryHeld;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderBy;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import org.springframework.data.domain.Persistable;

/**
 * The hotel part of a booking (same id as the booking). At first only the quote and the guests the customer entered
 * are known; the hotel, room, dates and cancellation terms are copied from hotel-service's {@code HotelInventoryHeld},
 * so they are exactly what was held and priced.
 */
@Getter
@Entity
@Table(name = "hotel_bookings")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class HotelBooking implements Persistable<UUID> {

    @Id
    @Column(name = "booking_id")
    private UUID bookingId;

    @Column(name = "quote_id", nullable = false, updatable = false)
    private UUID quoteId;

    @Column(name = "reservation_id")
    private UUID reservationId;

    @Column(name = "hotel_id")
    private UUID hotelId;

    @Column(name = "hotel_slug", length = 180)
    private String hotelSlug;

    @Column(name = "hotel_name", length = 150)
    private String hotelName;

    @Column(name = "hotel_city", length = 100)
    private String hotelCity;

    @Column(name = "hotel_address", length = 400)
    private String hotelAddress;

    @Column(name = "country_code", length = 2)
    private String countryCode;

    @Column(name = "room_type_id")
    private UUID roomTypeId;

    @Column(name = "room_type_name", length = 100)
    private String roomTypeName;

    @Column(name = "rate_plan_name", length = 100)
    private String ratePlanName;

    @Column(name = "breakfast_included")
    private Boolean breakfastIncluded;

    @Column(name = "check_in")
    private LocalDate checkIn;

    @Column(name = "check_out")
    private LocalDate checkOut;

    @Column(name = "check_in_time", length = 5)
    private String checkInTime;

    @Column(name = "check_out_time", length = 5)
    private String checkOutTime;

    private Integer nights;

    private Integer rooms;

    private Integer adults;

    private Integer children;

    @Column(name = "confirmation_number", length = 20)
    private String confirmationNumber;

    private Boolean refundable;

    @Column(name = "free_cancellation_until")
    private Instant freeCancellationUntil;

    @Column(name = "cancellation_fee_percent", precision = 5, scale = 2)
    private BigDecimal cancellationFeePercent;

    @Column(name = "special_requests", length = 500, updatable = false)
    private String specialRequests;

    @Column(nullable = false)
    private boolean demo;

    @ElementCollection
    @CollectionTable(name = "booking_guests", joinColumns = @JoinColumn(name = "booking_id"))
    @OrderBy("roomNo")
    private List<BookingGuest> guests = new ArrayList<>();

    public HotelBooking(UUID bookingId, UUID quoteId, List<BookingGuest> guests, String specialRequests) {
        this.bookingId = bookingId;
        this.quoteId = quoteId;
        this.guests.addAll(guests);
        this.specialRequests = specialRequests;
    }

    public void held(HotelInventoryHeld held) {
        reservationId = UUID.fromString(held.getReservationId());
        hotelId = UUID.fromString(held.getHotelId());
        hotelSlug = held.getHotelSlug();
        hotelName = held.getHotelName();
        hotelCity = held.getHotelCity();
        hotelAddress = held.getHotelAddress();
        countryCode = held.getCountryCode();
        roomTypeId = UUID.fromString(held.getRoomTypeId());
        roomTypeName = held.getRoomTypeName();
        ratePlanName = held.getRatePlanName();
        breakfastIncluded = held.getBreakfastIncluded();
        checkIn = held.getCheckIn();
        checkOut = held.getCheckOut();
        checkInTime = held.getCheckInTime();
        checkOutTime = held.getCheckOutTime();
        nights = held.getNights();
        rooms = held.getRooms();
        adults = held.getAdults();
        children = held.getChildren();
        refundable = held.getRefundable();
        freeCancellationUntil = held.getFreeCancellationUntil();
        cancellationFeePercent = held.getCancellationFeePercent();
        demo = held.getDemo();
    }

    public void confirmed(String number) {
        this.confirmationNumber = number;
    }

    /** The guest of room 1: greetings, invoice name. */
    public BookingGuest leadGuest() {
        return guests.stream().min(Comparator.comparingInt(BookingGuest::getRoomNo)).orElseThrow();
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
