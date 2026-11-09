package com.flighthotel.hotel.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;

import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelStatus;

public interface HotelRepository extends JpaRepository<Hotel, UUID>, JpaSpecificationExecutor<Hotel> {

    // Only the Set is fetched eagerly: fetching the ordered policy list too would multiply the rows (bag product).
    @EntityGraph(attributePaths = {"amenities"})
    Optional<Hotel> findWithDetailsById(UUID id);

    // Only the Set is fetched eagerly: fetching the ordered policy list too would multiply the rows (bag product).
    @EntityGraph(attributePaths = {"amenities"})
    Optional<Hotel> findWithDetailsBySlug(String slug);

    boolean existsBySlug(String slug);

    boolean existsByCityIgnoreCaseAndStatus(String city, HotelStatus status);

    @EntityGraph(attributePaths = {"amenities"})
    List<Hotel> findByIdIn(Collection<UUID> ids);

    List<Hotel> findByStatus(HotelStatus status);

    long countByStatus(HotelStatus status);

    /** Published hotels by guest rating (unrated last), then by number of reviews (home page). */
    @Query("""
            select h from Hotel h where h.status = com.flighthotel.hotel.entity.HotelStatus.ACTIVE
            order by case when h.avgRating is null then 1 else 0 end, h.avgRating desc, h.reviewCount desc, h.name asc""")
    List<Hotel> findRecommended(org.springframework.data.domain.Pageable pageable);

    /** Cities with active hotels, for the destination autocomplete. */
    @Query("""
            select h.city as city, h.countryCode as countryCode, count(h) as hotels from Hotel h
            where h.status = com.flighthotel.hotel.entity.HotelStatus.ACTIVE and lower(h.city) like :prefix
            group by h.city, h.countryCode order by count(h) desc, h.city asc""")
    List<CityCount> findActiveCities(String prefix, org.springframework.data.domain.Pageable pageable);

    interface CityCount {
        String getCity();

        String getCountryCode();

        long getHotels();
    }
}
