package com.flighthotel.identity.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.identity.entity.CustomerPassenger;

public interface CustomerPassengerRepository extends JpaRepository<CustomerPassenger, UUID> {

    List<CustomerPassenger> findByUserIdOrderByCreatedAtAsc(UUID userId);

    /** Always look up by id AND owner, so one customer can never read or change another customer's passenger. */
    Optional<CustomerPassenger> findByIdAndUserId(UUID id, UUID userId);

    long countByUserId(UUID userId);
}
