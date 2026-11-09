package com.flighthotel.hotel.entity;

import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import org.hibernate.annotations.BatchSize;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** A kind of room ("Deluxe King") with its capacity and the default number of rooms for sale per night. */
@Getter
@Setter
@Entity
@Table(name = "room_types")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RoomType extends AuditableEntity {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Setter(AccessLevel.NONE)
    private UUID id;

    @Column(name = "hotel_id", nullable = false)
    @Setter(AccessLevel.NONE)
    private UUID hotelId;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 2000)
    private String description;

    @Column(name = "max_adults", nullable = false)
    private int maxAdults;

    @Column(name = "max_children", nullable = false)
    private int maxChildren;

    @Column(name = "bed_configuration", nullable = false, length = 100)
    private String bedConfiguration;

    @Column(name = "size_sqm")
    private Integer sizeSqm;

    /** Changed through InventoryService, which also updates the future nights. */
    @Column(name = "total_rooms", nullable = false)
    private int totalRooms;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 10)
    private SalesStatus status = SalesStatus.ACTIVE;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @BatchSize(size = 50)
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "room_type_amenities",
            joinColumns = @JoinColumn(name = "room_type_id"),
            inverseJoinColumns = @JoinColumn(name = "amenity_id"))
    @Setter(AccessLevel.NONE)
    private Set<Amenity> amenities = new HashSet<>();

    @Version
    @Setter(AccessLevel.NONE)
    private Long version;

    public RoomType(UUID hotelId) {
        this.hotelId = hotelId;
    }

    public void replaceAmenities(Set<Amenity> newAmenities) {
        amenities.clear();
        amenities.addAll(newAmenities);
    }

    public Set<String> amenityCodes() {
        Set<String> codes = new TreeSet<>();
        amenities.forEach(amenity -> codes.add(amenity.getCode()));
        return codes;
    }

    /** Can `rooms` rooms of this type sleep the party? Adults need adult beds; children may use any free place. */
    public boolean fits(int rooms, int adults, int children) {
        return adults <= (long) maxAdults * rooms && adults + children <= (long) (maxAdults + maxChildren) * rooms
                && adults >= rooms;
    }

    public boolean isOnSale() {
        return status == SalesStatus.ACTIVE;
    }
}
