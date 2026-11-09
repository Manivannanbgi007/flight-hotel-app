package com.flighthotel.identity.entity;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.persistence.AuditableEntity;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One row per user, created the first time preferences are saved. */
@Getter
@Setter
@Entity
@Table(name = "travel_preferences")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TravelPreferences extends AuditableEntity {

    @Id
    @Column(name = "user_id")
    @Setter(AccessLevel.NONE)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "preferred_cabin", length = 20)
    private CabinClass preferredCabin;

    @Column(name = "home_airport", length = 3)
    private String homeAirport;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "seat_preference", length = 20)
    private SeatPreference seatPreference;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "meal_preference", length = 20)
    private MealPreference mealPreference;

    @Column(name = "preferred_currency", nullable = false, length = 3)
    private String preferredCurrency = "INR";

    @Column(name = "newsletter_opt_in", nullable = false)
    private boolean newsletterOptIn;

    /** Null until first saved, so Spring Data treats a new row as "insert". */
    @Version
    @Setter(AccessLevel.NONE)
    private Long version;

    public TravelPreferences(UUID userId) {
        this.userId = userId;
    }
}
