package com.flighthotel.hotel.entity;

import java.math.BigDecimal;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import org.hibernate.annotations.BatchSize;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.persistence.AuditableEntity;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** A property customers can search and book (DATABASE_DESIGN.md §3). */
@Getter
@Setter
@Entity
@Table(name = "hotels")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Hotel extends AuditableEntity {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Setter(AccessLevel.NONE)
    private UUID id;

    @Column(nullable = false, length = 150)
    private String name;

    @Column(nullable = false, unique = true, length = 180)
    private String slug;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "property_type", nullable = false, length = 20)
    private PropertyType propertyType;

    @Column(name = "star_rating")
    private Integer starRating;

    @Column(name = "address_line", nullable = false)
    private String addressLine;

    @Column(nullable = false, length = 100)
    private String city;

    @Column(length = 100)
    private String state;

    @Column(name = "country_code", nullable = false, length = 2)
    private String countryCode;

    @Column(name = "postal_code", length = 20)
    private String postalCode;

    @Column(precision = 9, scale = 6)
    private BigDecimal latitude;

    @Column(precision = 9, scale = 6)
    private BigDecimal longitude;

    @Column(name = "time_zone", nullable = false, length = 40)
    private String timeZone = "Asia/Kolkata";

    @Column(name = "check_in_time", nullable = false)
    private LocalTime checkInTime = LocalTime.of(14, 0);

    @Column(name = "check_out_time", nullable = false)
    private LocalTime checkOutTime = LocalTime.of(11, 0);

    @Column(name = "contact_email", length = 254)
    private String contactEmail;

    @Column(name = "contact_phone", length = 20)
    private String contactPhone;

    /*
     * Guest rating: written once when the hotel is created (demo figures) and afterwards only by HotelRatings, with
     * its own UPDATE when a review is approved or withdrawn. Not updatable here, so a profile edit can never write
     * back an older rating it happened to load (and a rating change does not bump the version managers edit).
     */
    @Column(name = "avg_rating", precision = 2, scale = 1, updatable = false)
    @Setter(AccessLevel.NONE)
    private BigDecimal avgRating;

    @Column(name = "review_count", nullable = false, updatable = false)
    @Setter(AccessLevel.NONE)
    private int reviewCount;

    /** Rating figures the hotel started with (the labelled demo data); approved reviews are added to them. */
    @Column(name = "seed_rating", precision = 2, scale = 1, updatable = false)
    @Setter(AccessLevel.NONE)
    private BigDecimal seedRating;

    @Column(name = "seed_review_count", nullable = false, updatable = false)
    @Setter(AccessLevel.NONE)
    private int seedReviewCount;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 10)
    @Setter(AccessLevel.NONE)
    private HotelStatus status = HotelStatus.DRAFT;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "data_source", nullable = false, length = 10)
    @Setter(AccessLevel.NONE)
    private DataSource dataSource;

    @BatchSize(size = 50)
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "hotel_amenities",
            joinColumns = @JoinColumn(name = "hotel_id"),
            inverseJoinColumns = @JoinColumn(name = "amenity_id"))
    @Setter(AccessLevel.NONE)
    private Set<Amenity> amenities = new HashSet<>();

    @BatchSize(size = 50)
    @OneToMany(mappedBy = "hotel", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC")
    @Setter(AccessLevel.NONE)
    private List<HotelPolicy> policies = new ArrayList<>();

    @Version
    @Setter(AccessLevel.NONE)
    private Long version;

    public Hotel(String name, String slug, PropertyType propertyType, String addressLine, String city,
            String countryCode, DataSource dataSource) {
        this.name = name;
        this.slug = slug;
        this.propertyType = propertyType;
        this.addressLine = addressLine;
        this.city = city;
        this.countryCode = countryCode;
        this.dataSource = dataSource;
    }

    public void changeStatus(HotelStatus newStatus) {
        this.status = newStatus;
    }

    /**
     * Starting rating figures of a new hotel (demo data: "4.4 from 312 reviews"). Only takes effect when the hotel is
     * first saved; approved reviews are combined with them later (HotelRatings).
     */
    public void startWithRating(BigDecimal rating, int reviews) {
        this.seedRating = rating;
        this.seedReviewCount = reviews;
        this.avgRating = rating;
        this.reviewCount = reviews;
    }

    public void replaceAmenities(Set<Amenity> newAmenities) {
        amenities.clear();
        amenities.addAll(newAmenities);
    }

    /** Replaces the hotel rules (in the given order). */
    public void replacePolicies(List<HotelPolicy> newPolicies) {
        policies.clear();
        for (int i = 0; i < newPolicies.size(); i++) {
            HotelPolicy policy = newPolicies.get(i);
            policy.attachTo(this, i);
            policies.add(policy);
        }
    }

    public Set<String> amenityCodes() {
        Set<String> codes = new TreeSet<>();
        amenities.forEach(amenity -> codes.add(amenity.getCode()));
        return codes;
    }

    public boolean isActive() {
        return status == HotelStatus.ACTIVE;
    }
}
