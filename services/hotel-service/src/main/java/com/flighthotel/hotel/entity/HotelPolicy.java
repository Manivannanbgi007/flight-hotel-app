package com.flighthotel.hotel.entity;

import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** A hotel rule ("Pets are not allowed", "Government ID required at check-in"). */
@Getter
@Entity
@Table(name = "hotel_policies")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class HotelPolicy {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "hotel_id")
    private Hotel hotel;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "policy_type", nullable = false, length = 20)
    private PolicyType policyType;

    @Column(nullable = false, length = 1000)
    private String description;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    public HotelPolicy(PolicyType policyType, String description) {
        this.policyType = policyType;
        this.description = description;
    }

    void attachTo(Hotel owner, int order) {
        this.hotel = owner;
        this.sortOrder = order;
    }
}
