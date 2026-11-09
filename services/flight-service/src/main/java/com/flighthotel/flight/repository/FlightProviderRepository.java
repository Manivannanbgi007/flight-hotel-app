package com.flighthotel.flight.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.flight.entity.FlightProviderEntity;

public interface FlightProviderRepository extends JpaRepository<FlightProviderEntity, UUID> {

    Optional<FlightProviderEntity> findByCode(String code);

    List<FlightProviderEntity> findAllByOrderByPriorityAsc();
}
