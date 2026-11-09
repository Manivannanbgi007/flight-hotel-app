package com.flighthotel.hotel.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.UuidGenerator;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** A hotel (or room type) photo: a large version and a thumbnail, both re-encoded JPEGs in file storage. */
@Getter
@Entity
@Table(name = "hotel_images")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class HotelImage {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    private UUID id;

    @Column(name = "hotel_id", nullable = false)
    private UUID hotelId;

    @Setter
    @Column(name = "room_type_id")
    private UUID roomTypeId;

    @Column(name = "storage_key", nullable = false)
    private String storageKey;

    @Column(name = "thumb_key", nullable = false)
    private String thumbKey;

    @Setter
    @Column(length = 200)
    private String caption;

    @Setter
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Setter
    @Column(name = "is_cover", nullable = false)
    private boolean cover;

    @Column(nullable = false)
    private int width;

    @Column(nullable = false)
    private int height;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, length = 64)
    private String createdBy;

    public HotelImage(UUID hotelId, String storageKey, String thumbKey, int width, int height, Instant createdAt,
            String createdBy) {
        this.hotelId = hotelId;
        this.storageKey = storageKey;
        this.thumbKey = thumbKey;
        this.width = width;
        this.height = height;
        this.createdAt = createdAt;
        this.createdBy = createdBy;
    }
}
