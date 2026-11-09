package com.flighthotel.hotel.repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.hotel.entity.Amenity;

public interface AmenityRepository extends JpaRepository<Amenity, UUID> {

    List<Amenity> findByCodeIn(Collection<String> codes);

    List<Amenity> findAllByOrderByCategoryAscNameAsc();
}
