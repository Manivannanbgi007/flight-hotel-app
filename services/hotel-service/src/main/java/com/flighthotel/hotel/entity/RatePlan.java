package com.flighthotel.hotel.entity;

import java.math.BigDecimal;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One way to sell a room type: base price per night, meals and cancellation terms.
 * <p>
 * Cancellation: free until {@code freeCancellationHours} before check-in, afterwards {@code cancellationFeePercent}
 * of the total. Non-refundable plans have no free period and a 100 % fee.
 */
@Getter
@Setter
@Entity
@Table(name = "rate_plans")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RatePlan extends AuditableEntity {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Setter(AccessLevel.NONE)
    private UUID id;

    @Column(name = "room_type_id", nullable = false)
    @Setter(AccessLevel.NONE)
    private UUID roomTypeId;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(name = "base_price_per_night", nullable = false, precision = 12, scale = 2)
    private BigDecimal basePricePerNight;

    @Column(nullable = false, length = 3)
    private String currency = "INR";

    @Column(name = "breakfast_included", nullable = false)
    private boolean breakfastIncluded;

    @Column(nullable = false)
    @Setter(AccessLevel.NONE)
    private boolean refundable;

    @Column(name = "free_cancellation_hours")
    @Setter(AccessLevel.NONE)
    private Integer freeCancellationHours;

    @Column(name = "cancellation_fee_percent", nullable = false, precision = 5, scale = 2)
    @Setter(AccessLevel.NONE)
    private BigDecimal cancellationFeePercent;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 10)
    private SalesStatus status = SalesStatus.ACTIVE;

    @Version
    @Setter(AccessLevel.NONE)
    private Long version;

    public RatePlan(UUID roomTypeId) {
        this.roomTypeId = roomTypeId;
    }

    /**
     * @param freeHours hours before check-in until which cancelling is free (refundable plans only)
     * @param feePercent fee after that, % of the total
     */
    public void setCancellation(boolean refundable, Integer freeHours, BigDecimal feePercent) {
        this.refundable = refundable;
        this.freeCancellationHours = refundable ? freeHours : null;
        this.cancellationFeePercent = refundable ? feePercent : BigDecimal.valueOf(100);
    }

    /** Free cancellation is possible at some point (what the "Free cancellation" filter means). */
    public boolean hasFreeCancellation() {
        return refundable && freeCancellationHours != null;
    }

    public boolean isOnSale() {
        return status == SalesStatus.ACTIVE;
    }
}
