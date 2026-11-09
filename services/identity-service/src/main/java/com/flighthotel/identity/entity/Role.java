package com.flighthotel.identity.entity;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.Table;

import org.hibernate.annotations.BatchSize;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** CUSTOMER, ADMIN, HOTEL_MANAGER or SUPPORT_AGENT. Reference data seeded by Flyway. */
@Getter
@Entity
@Table(name = "roles")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Role {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true, length = 40)
    private String name;

    @Column(nullable = false)
    private String description;

    @BatchSize(size = 10)
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "role_permissions",
            joinColumns = @JoinColumn(name = "role_id"),
            inverseJoinColumns = @JoinColumn(name = "permission_id"))
    private Set<Permission> permissions = new HashSet<>();
}
