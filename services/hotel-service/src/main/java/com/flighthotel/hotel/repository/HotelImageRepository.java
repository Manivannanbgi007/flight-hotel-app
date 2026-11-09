package com.flighthotel.hotel.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.flighthotel.hotel.entity.HotelImage;

public interface HotelImageRepository extends JpaRepository<HotelImage, UUID> {

    List<HotelImage> findByHotelIdOrderBySortOrderAscCreatedAtAsc(UUID hotelId);

    List<HotelImage> findByHotelIdInAndCoverTrue(Collection<UUID> hotelIds);

    Optional<HotelImage> findByIdAndHotelId(UUID id, UUID hotelId);

    long countByHotelId(UUID hotelId);
}
