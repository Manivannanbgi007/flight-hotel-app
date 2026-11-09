package com.flighthotel.booking.entity;

import java.time.LocalDate;
import java.util.UUID;

import com.flighthotel.common.crypto.EncryptedStringConverter;
import com.flighthotel.common.id.UuidV7;

import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** One traveller of a flight booking. The passport number is encrypted at rest and never leaves this service. */
@Getter
@Entity
@Table(name = "booking_passengers")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class BookingPassenger {

    /** What the customer entered for one traveller. */
    public record Details(int passengerNo, String type, String firstName, String lastName, LocalDate dateOfBirth,
            String gender, String nationality, String passportNumber, LocalDate passportExpiry,
            String passportCountry) {
    }

    @Id
    private UUID id;

    @Column(name = "booking_id", nullable = false, updatable = false)
    private UUID bookingId;

    @Column(name = "passenger_no", nullable = false, updatable = false)
    private int passengerNo;

    @Column(name = "passenger_type", nullable = false, updatable = false, length = 10)
    private String passengerType;

    @Column(name = "first_name", nullable = false, updatable = false, length = 60)
    private String firstName;

    @Column(name = "last_name", nullable = false, updatable = false, length = 60)
    private String lastName;

    @Column(name = "date_of_birth", updatable = false)
    private LocalDate dateOfBirth;

    @Column(length = 10, updatable = false)
    private String gender;

    @Column(length = 2, updatable = false)
    private String nationality;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "passport_number_enc", updatable = false)
    private String passportNumber;

    @Column(name = "passport_last4", length = 4, updatable = false)
    private String passportLast4;

    @Column(name = "passport_expiry", updatable = false)
    private LocalDate passportExpiry;

    @Column(name = "passport_country", length = 2, updatable = false)
    private String passportCountry;

    @Column(name = "ticket_number", length = 20)
    private String ticketNumber;

    public BookingPassenger(UUID bookingId, Details details) {
        this.id = UuidV7.generate();
        this.bookingId = bookingId;
        this.passengerNo = details.passengerNo();
        this.passengerType = details.type();
        this.firstName = details.firstName();
        this.lastName = details.lastName();
        this.dateOfBirth = details.dateOfBirth();
        this.gender = details.gender();
        this.nationality = details.nationality();
        this.passportNumber = details.passportNumber();
        this.passportLast4 = details.passportNumber() == null ? null
                : details.passportNumber().substring(Math.max(0, details.passportNumber().length() - 4));
        this.passportExpiry = details.passportExpiry();
        this.passportCountry = details.passportCountry();
    }

    public void ticket(String ticketNumber) {
        this.ticketNumber = ticketNumber;
    }

    public String fullName() {
        return firstName + " " + lastName;
    }
}
