package com.flighthotel.hotel.manager;

import java.text.Normalizer;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

import org.springframework.stereotype.Component;

import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.hotel.entity.Amenity;
import com.flighthotel.hotel.entity.AmenityCategory;
import com.flighthotel.hotel.repository.AmenityRepository;
import com.flighthotel.hotel.repository.HotelRepository;

/** Small rules shared by the catalog services: amenity codes, URL names, optimistic versions. */
@Component
public class CatalogSupport {

    private final AmenityRepository amenities;
    private final HotelRepository hotels;

    public CatalogSupport(AmenityRepository amenities, HotelRepository hotels) {
        this.amenities = amenities;
        this.hotels = hotels;
    }

    /** Amenities for the given codes of one category; unknown or wrong-category codes are rejected (422). */
    public Set<Amenity> resolveAmenities(Collection<String> codes, AmenityCategory category) {
        if (codes.isEmpty()) {
            return new HashSet<>();
        }
        Set<String> wanted = new TreeSet<>(codes);
        List<Amenity> found = amenities.findByCodeIn(wanted).stream()
                .filter(amenity -> amenity.getCategory() == category).toList();
        if (found.size() != wanted.size()) {
            Set<String> unknown = new TreeSet<>(wanted);
            found.forEach(amenity -> unknown.remove(amenity.getCode()));
            throw new BusinessRuleException("UNKNOWN_AMENITY", "Unknown " + category.name().toLowerCase(Locale.ROOT)
                    + " amenity: " + String.join(", ", unknown), Map.of("codes", List.copyOf(unknown)));
        }
        return new HashSet<>(found);
    }

    /** "Sea Breeze Résort", "Goa" → "sea-breeze-resort-goa" (with -2, -3, ... when taken). */
    public String uniqueSlug(String name, String city) {
        String base = slugify(name + " " + city);
        String candidate = base;
        for (int n = 2; hotels.existsBySlug(candidate); n++) {
            candidate = base + "-" + n;
        }
        return candidate;
    }

    static String slugify(String text) {
        String ascii = Normalizer.normalize(text, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        String slug = ascii.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
        if (slug.isEmpty()) {
            slug = "hotel";
        }
        return slug.length() > 170 ? slug.substring(0, 170).replaceAll("-$", "") : slug;
    }

    /** The client sends the version it edited; if someone saved in between, nothing is overwritten. */
    public static void checkVersion(Long expected, Long actual) {
        if (expected != null && !Objects.equals(expected, actual)) {
            throw new ConflictException("CONCURRENT_MODIFICATION",
                    "This record was changed by someone else. Reload and try again.");
        }
    }
}
