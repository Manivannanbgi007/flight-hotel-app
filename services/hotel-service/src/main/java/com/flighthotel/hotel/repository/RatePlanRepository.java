package com.flighthotel.hotel.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.SalesStatus;

public interface RatePlanRepository extends JpaRepository<RatePlan, UUID> {

    List<RatePlan> findByRoomTypeIdInOrderByBasePricePerNightAsc(Collection<UUID> roomTypeIds);

    List<RatePlan> findByRoomTypeIdInAndStatus(Collection<UUID> roomTypeIds, SalesStatus status);

    Optional<RatePlan> findByIdAndRoomTypeId(UUID id, UUID roomTypeId);
}
