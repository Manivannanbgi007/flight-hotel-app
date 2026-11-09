package com.flighthotel.hotel.controller;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.storage.FileStorage;
import com.flighthotel.hotel.dto.PublicHotelDtos.AmenityResponse;
import com.flighthotel.hotel.dto.PublicHotelDtos.DestinationSuggestion;
import com.flighthotel.hotel.dto.PublicHotelDtos.HotelDetails;
import com.flighthotel.hotel.dto.PublicHotelDtos.Quote;
import com.flighthotel.hotel.dto.PublicHotelDtos.QuoteRequest;
import com.flighthotel.hotel.dto.PublicHotelDtos.RecommendedHotel;
import com.flighthotel.hotel.dto.PublicHotelDtos.RoomsResponse;
import com.flighthotel.hotel.dto.PublicHotelDtos.SearchCriteria;
import com.flighthotel.hotel.dto.PublicHotelDtos.SearchResponse;
import com.flighthotel.hotel.dto.PublicHotelDtos.SearchSort;
import com.flighthotel.hotel.dto.PublicHotelDtos.Stay;
import com.flighthotel.hotel.dto.ReviewDtos.HotelReviewsPage;
import com.flighthotel.hotel.dto.ReviewDtos.ReviewSort;
import com.flighthotel.hotel.entity.HotelImage;
import com.flighthotel.hotel.entity.PropertyType;
import com.flighthotel.hotel.repository.AmenityRepository;
import com.flighthotel.hotel.repository.HotelImageRepository;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.review.PublicReviewService;
import com.flighthotel.hotel.search.HotelDetailsService;
import com.flighthotel.hotel.search.HotelSearchService;
import com.flighthotel.hotel.search.QuoteService;
import com.flighthotel.hotel.search.RecommendedHotelsService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.Validator;

/** Public hotel API (no login): search, details, rooms for a stay, quotes, photos, reviews, recommended hotels. */
@RestController
@RequestMapping("/api/hotels")
@Tag(name = "Hotels", description = "Search, details, availability and quotes (public)")
public class PublicHotelController {

    private final HotelSearchService search;
    private final HotelDetailsService details;
    private final QuoteService quotes;
    private final HotelRepository hotels;
    private final AmenityRepository amenities;
    private final HotelImageRepository images;
    private final FileStorage fileStorage;
    private final Validator validator;
    private final PublicReviewService reviews;
    private final RecommendedHotelsService recommended;

    public PublicHotelController(HotelSearchService search, HotelDetailsService details, QuoteService quotes,
            HotelRepository hotels, AmenityRepository amenities, HotelImageRepository images, FileStorage fileStorage,
            Validator validator, PublicReviewService reviews, RecommendedHotelsService recommended) {
        this.search = search;
        this.details = details;
        this.quotes = quotes;
        this.hotels = hotels;
        this.amenities = amenities;
        this.images = images;
        this.fileStorage = fileStorage;
        this.validator = validator;
        this.reviews = reviews;
        this.recommended = recommended;
    }

    @GetMapping("/search")
    @Operation(summary = "Search hotels for a stay",
            description = "Lists: comma separated (stars=4,5&amenities=POOL,SPA). Prices are per room per night before taxes.")
    public SearchResponse search(
            @RequestParam String destination,
            @RequestParam LocalDate checkIn,
            @RequestParam LocalDate checkOut,
            @RequestParam(defaultValue = "1") int rooms,
            @RequestParam(defaultValue = "2") int adults,
            @RequestParam(defaultValue = "0") int children,
            @RequestParam(required = false) List<Integer> childAges,
            @RequestParam(required = false) BigDecimal minPrice,
            @RequestParam(required = false) BigDecimal maxPrice,
            @RequestParam(required = false) Set<Integer> stars,
            @RequestParam(required = false) BigDecimal minGuestRating,
            @RequestParam(required = false) Set<String> amenities,
            @RequestParam(required = false) Set<PropertyType> propertyTypes,
            @RequestParam(defaultValue = "false") boolean freeCancellation,
            @RequestParam(defaultValue = "false") boolean breakfastIncluded,
            @RequestParam(required = false) Double maxDistanceKm,
            @RequestParam(defaultValue = "true") boolean availableOnly,
            @RequestParam(defaultValue = "RECOMMENDED") SearchSort sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        SearchCriteria criteria = new SearchCriteria(destination,
                new Stay(checkIn, checkOut, rooms, adults, children, childAges), minPrice, maxPrice, stars, minGuestRating,
                amenities, propertyTypes, freeCancellation, breakfastIncluded, maxDistanceKm, availableOnly, sort, page,
                size);
        var violations = validator.validate(criteria);
        if (!violations.isEmpty()) {
            throw new ConstraintViolationException(violations);
        }
        return search.search(criteria);
    }

    @GetMapping("/destinations")
    @Operation(summary = "Destination suggestions for the search box (cities with hotels)")
    public List<DestinationSuggestion> destinations(@RequestParam(defaultValue = "") String q) {
        String prefix = q.trim().toLowerCase(Locale.ROOT).replace("%", "").replace("_", "") + "%";
        return hotels.findActiveCities(prefix, PageRequest.of(0, 8)).stream()
                .map(c -> new DestinationSuggestion(c.getCity(), c.getCountryCode(), c.getHotels()))
                .toList();
    }

    @GetMapping("/amenities")
    @Operation(summary = "All amenities (for filters and the manager screens)")
    public List<AmenityResponse> amenities() {
        return amenities.findAllByOrderByCategoryAscNameAsc().stream()
                .map(a -> new AmenityResponse(a.getCode(), a.getName(), a.getCategory().name()))
                .toList();
    }

    @GetMapping("/recommended")
    @Operation(summary = "Published hotels with the best guest rating, with cover photo and \"from\" price (home page)")
    public List<RecommendedHotel> recommended(@RequestParam(defaultValue = "6") int limit) {
        return recommended.recommended(limit);
    }

    @GetMapping("/{idOrSlug}/reviews")
    @Operation(summary = "Approved reviews of a hotel with their summary (average, count, stars distribution)")
    public HotelReviewsPage reviews(@PathVariable String idOrSlug,
            @RequestParam(defaultValue = "RECENT") ReviewSort sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return reviews.hotelReviews(idOrSlug, sort, page, size);
    }

    @GetMapping("/{idOrSlug}")
    @Operation(summary = "Hotel details (by id or URL name)")
    public HotelDetails details(@PathVariable String idOrSlug) {
        return details.details(idOrSlug);
    }

    @GetMapping("/{hotelId}/rooms")
    @Operation(summary = "Room types, availability and prices of a hotel for a stay")
    public RoomsResponse rooms(@PathVariable UUID hotelId,
            @RequestParam LocalDate checkIn,
            @RequestParam LocalDate checkOut,
            @RequestParam(defaultValue = "1") int rooms,
            @RequestParam(defaultValue = "2") int adults,
            @RequestParam(defaultValue = "0") int children,
            @RequestParam(required = false) List<Integer> childAges) {
        Stay stay = new Stay(checkIn, checkOut, rooms, adults, children, childAges);
        var violations = validator.validate(stay);
        if (!violations.isEmpty()) {
            throw new ConstraintViolationException(violations);
        }
        return details.rooms(hotelId, stay);
    }

    @PostMapping("/availability")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Re-check availability and price and get a quote valid for 15 minutes",
            description = "Nothing is reserved yet; booking (Phase 5) holds the rooms against the quote.")
    public Quote quote(@Valid @RequestBody QuoteRequest request) {
        return quotes.create(request);
    }

    @GetMapping("/quotes/{quoteId}")
    @Operation(summary = "A quote that has not expired")
    public Quote getQuote(@PathVariable UUID quoteId) {
        return quotes.find(quoteId).orElseThrow(() -> new ResourceNotFoundException("Quote", quoteId));
    }

    /** Photos never change under the same id, so browsers may cache them for a long time. */
    @GetMapping(path = "/images/{imageId}", produces = MediaType.IMAGE_JPEG_VALUE)
    @Operation(summary = "A hotel photo (size=thumb for the 480 px version)")
    public ResponseEntity<byte[]> image(@PathVariable UUID imageId, @RequestParam(defaultValue = "large") String size) {
        HotelImage image = images.findById(imageId).orElseThrow(() -> new ResourceNotFoundException("Image", imageId));
        String key = "thumb".equals(size) ? image.getThumbKey() : image.getStorageKey();
        byte[] bytes = fileStorage.load(key).orElseThrow(() -> new ResourceNotFoundException("Image", imageId));
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .cacheControl(CacheControl.maxAge(Duration.ofDays(30)).cachePublic().immutable())
                .body(bytes);
    }
}
