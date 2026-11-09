package com.flighthotel.booking.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.UuidGenerator;

import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A promotion shown on the home page and the Offers page. It only advertises a {@link Coupon}: the discount rules are
 * always the coupon's, and an offer is shown only while both are active and valid.
 */
@Getter
@Setter
@Entity
@Table(name = "offers")
@NoArgsConstructor
public class Offer extends AuditableEntity {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Setter(AccessLevel.NONE)
    private UUID id;

    @Column(nullable = false, length = 80)
    private String title;

    @Column(length = 300)
    private String description;

    @Column(name = "coupon_id", nullable = false)
    private UUID couponId;

    @Column(name = "applies_to", nullable = false, length = 10)
    private String appliesTo = Coupon.ALL;

    @Column(name = "destination_city", length = 100)
    private String destinationCity;

    @Column(name = "valid_from", nullable = false)
    private Instant validFrom;

    @Column(name = "valid_to", nullable = false)
    private Instant validTo;

    @Column(nullable = false)
    private boolean seasonal;

    @Column(nullable = false, length = 10)
    private String theme = "OCEAN";

    @Column(nullable = false, length = 10)
    private String status = "ACTIVE";

    @Column(nullable = false)
    private boolean demo;

    @Version
    @Setter(AccessLevel.NONE)
    private Long version;

    public boolean isLiveAt(Instant now) {
        return "ACTIVE".equals(status) && !now.isBefore(validFrom) && now.isBefore(validTo);
    }
}
