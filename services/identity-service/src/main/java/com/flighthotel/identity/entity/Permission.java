package com.flighthotel.identity.entity;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** Fine-grained right, e.g. {@code BOOKING_READ_ANY}. Reference data seeded by Flyway. */
@Getter
@Entity
@Table(name = "permissions")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Permission {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true, length = 60)
    private String code;

    @Column(nullable = false)
    private String description;
}
