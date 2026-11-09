package com.flighthotel.booking.repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.flighthotel.booking.entity.Offer;

public interface OfferRepository extends JpaRepository<Offer, UUID> {

    /** Offers that may be shown now (the coupon is checked by the caller), newest first. */
    @Query("select o from Offer o where o.status = 'ACTIVE' and o.validFrom <= :now and o.validTo > :now "
            + "order by o.createdAt desc")
    List<Offer> findLive(@Param("now") Instant now);

    @Query("select o from Offer o where (:status is null or o.status = :status) and (:q is null "
            + "or lower(o.title) like :q or lower(coalesce(o.destinationCity, '')) like :q)")
    Page<Offer> search(@Param("q") String q, @Param("status") String status, Pageable page);

    boolean existsByTitle(String title);
}
