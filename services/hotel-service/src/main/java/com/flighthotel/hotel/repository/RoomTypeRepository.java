package com.flighthotel.hotel.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.entity.SalesStatus;

public interface RoomTypeRepository extends JpaRepository<RoomType, UUID> {

    @EntityGraph(attributePaths = {"amenities"})
    List<RoomType> findByHotelIdOrderBySortOrderAscNameAsc(UUID hotelId);

    List<RoomType> findByHotelIdInAndStatus(Collection<UUID> hotelIds, SalesStatus status);

    Optional<RoomType> findByIdAndHotelId(UUID id, UUID hotelId);

    List<RoomType> findByStatus(SalesStatus status);
}
