package com.flighthotel.hotel.entity;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import org.hibernate.annotations.UuidGenerator;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** A seasonal price: replaces the base price for the nights from {@code startDate} to {@code endDate} (inclusive). */
@Getter
@Entity
@Table(name = "room_rates")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SeasonalRate {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    private UUID id;

    @Column(name = "rate_plan_id", nullable = false)
    private UUID ratePlanId;

    @Column(nullable = false, length = 80)
    private String label;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "end_date", nullable = false)
    private LocalDate endDate;

    @Column(name = "price_per_night", nullable = false, precision = 12, scale = 2)
    private BigDecimal pricePerNight;

    @Column(nullable = false)
    private int priority;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, length = 64)
    private String createdBy;

    public SeasonalRate(UUID ratePlanId, String label, LocalDate startDate, LocalDate endDate, BigDecimal pricePerNight,
            int priority, Instant createdAt, String createdBy) {
        this.ratePlanId = ratePlanId;
        this.label = label;
        this.startDate = startDate;
        this.endDate = endDate;
        this.pricePerNight = pricePerNight;
        this.priority = priority;
        this.createdAt = createdAt;
        this.createdBy = createdBy;
    }

    public boolean covers(LocalDate night) {
        return !night.isBefore(startDate) && !night.isAfter(endDate);
    }
}
