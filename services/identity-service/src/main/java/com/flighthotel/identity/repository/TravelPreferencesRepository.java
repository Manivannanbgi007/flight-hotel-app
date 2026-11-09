package com.flighthotel.identity.repository;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.identity.entity.TravelPreferences;

public interface TravelPreferencesRepository extends JpaRepository<TravelPreferences, UUID> {
}
