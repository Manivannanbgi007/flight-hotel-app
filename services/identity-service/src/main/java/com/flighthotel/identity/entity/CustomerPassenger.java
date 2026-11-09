package com.flighthotel.identity.entity;

import java.time.LocalDate;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.crypto.EncryptedStringConverter;
import com.flighthotel.common.persistence.AuditableEntity;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** A traveller saved by a customer for faster flight bookings. The passport number is encrypted at rest. */
@Getter
@Setter
@Entity
@Table(name = "customer_passengers")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CustomerPassenger extends AuditableEntity {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Setter(AccessLevel.NONE)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    @Setter(AccessLevel.NONE)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "passenger_type", nullable = false, length = 10)
    private PassengerType passengerType;

    @Column(name = "first_name", nullable = false, length = 80)
    private String firstName;

    @Column(name = "last_name", nullable = false, length = 80)
    private String lastName;

    @Column(name = "date_of_birth")
    private LocalDate dateOfBirth;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(length = 10)
    private Gender gender;

    @Column(length = 2)
    private String nationality;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "passport_number_enc")
    @Setter(AccessLevel.NONE)
    private String passportNumber;

    @Column(name = "passport_last4", length = 4)
    @Setter(AccessLevel.NONE)
    private String passportLast4;

    @Column(name = "passport_expiry")
    @Setter(AccessLevel.NONE)
    private LocalDate passportExpiry;

    @Column(name = "passport_country", length = 2)
    @Setter(AccessLevel.NONE)
    private String passportCountry;

    @Version
    @Setter(AccessLevel.NONE)
    private Long version;

    public CustomerPassenger(UUID userId) {
        this.userId = userId;
    }

    public void setPassport(String number, LocalDate expiry, String country) {
        this.passportNumber = number;
        this.passportLast4 = number.substring(Math.max(0, number.length() - 4));
        this.passportExpiry = expiry;
        this.passportCountry = country;
    }

    public void removePassport() {
        this.passportNumber = null;
        this.passportLast4 = null;
        this.passportExpiry = null;
        this.passportCountry = null;
    }

    public boolean hasPassport() {
        return passportLast4 != null;
    }
}
