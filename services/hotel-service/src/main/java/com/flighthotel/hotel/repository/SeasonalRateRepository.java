package com.flighthotel.hotel.repository;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.hotel.entity.SeasonalRate;

public interface SeasonalRateRepository extends JpaRepository<SeasonalRate, UUID> {

    List<SeasonalRate> findByRatePlanIdOrderByStartDateAsc(UUID ratePlanId);

    Optional<SeasonalRate> findByIdAndRatePlanId(UUID id, UUID ratePlanId);

    /** Seasonal prices that touch at least one night of [checkIn, checkOut). */
    @Query("""
            select r from SeasonalRate r where r.ratePlanId in :planIds
            and r.startDate < :checkOut and r.endDate >= :checkIn""")
    List<SeasonalRate> findOverlapping(@Param("planIds") Collection<UUID> planIds, @Param("checkIn") LocalDate checkIn,
            @Param("checkOut") LocalDate checkOut);
}
