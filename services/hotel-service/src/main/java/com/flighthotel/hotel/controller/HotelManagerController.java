package com.flighthotel.hotel.controller;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.hotel.dto.ManagerDtos.HotelProfile;
import com.flighthotel.hotel.dto.ManagerDtos.HotelSummary;
import com.flighthotel.hotel.dto.ManagerDtos.ImageItem;
import com.flighthotel.hotel.dto.ManagerDtos.InventoryCalendar;
import com.flighthotel.hotel.dto.ManagerDtos.RatePlanItem;
import com.flighthotel.hotel.dto.ManagerDtos.RatePlanRequest;
import com.flighthotel.hotel.dto.ManagerDtos.RoomTypeItem;
import com.flighthotel.hotel.dto.ManagerDtos.RoomTypeRequest;
import com.flighthotel.hotel.dto.ManagerDtos.SeasonalRateItem;
import com.flighthotel.hotel.dto.ManagerDtos.SeasonalRateRequest;
import com.flighthotel.hotel.dto.ManagerDtos.UpdateHotelProfileRequest;
import com.flighthotel.hotel.dto.ManagerDtos.UpdateImageRequest;
import com.flighthotel.hotel.dto.ManagerDtos.UpdateInventoryRequest;
import com.flighthotel.hotel.dto.ReviewDtos.ManagerReview;
import com.flighthotel.hotel.dto.ReviewDtos.ManagerReviewSummary;
import com.flighthotel.hotel.entity.ReviewStatus;
import com.flighthotel.hotel.manager.InventoryCalendarService;
import com.flighthotel.hotel.manager.ManagerHotelService;
import com.flighthotel.hotel.manager.RoomCatalogService;
import com.flighthotel.hotel.review.ManagerReviewService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/** Hotel manager portal API. Managers reach only their assigned hotels; admins reach all (HotelAccess). */
@RestController
@RequestMapping("/api/hotel-manager/hotels")
@Tag(name = "Hotel manager")
public class HotelManagerController {

    private final ManagerHotelService hotels;
    private final RoomCatalogService rooms;
    private final InventoryCalendarService inventory;
    private final ManagerReviewService reviews;

    public HotelManagerController(ManagerHotelService hotels, RoomCatalogService rooms, InventoryCalendarService inventory,
            ManagerReviewService reviews) {
        this.hotels = hotels;
        this.rooms = rooms;
        this.inventory = inventory;
        this.reviews = reviews;
    }

    @GetMapping
    @Operation(summary = "Hotels I manage (admins: all hotels)")
    public List<HotelSummary> myHotels() {
        return hotels.myHotels();
    }

    @GetMapping("/{hotelId}")
    @Operation(summary = "Hotel profile")
    public HotelProfile profile(@PathVariable UUID hotelId) {
        return hotels.profile(hotelId);
    }

    @PutMapping("/{hotelId}")
    @Operation(summary = "Update the hotel profile (send the version you edited)")
    public HotelProfile updateProfile(@PathVariable UUID hotelId, @Valid @RequestBody UpdateHotelProfileRequest request) {
        return hotels.updateProfile(hotelId, request);
    }

    @PostMapping(path = "/{hotelId}/images", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Upload a photo (JPEG/PNG, max 5 MB); optionally for a room type")
    public ImageItem uploadImage(@PathVariable UUID hotelId, @RequestPart("file") MultipartFile file,
            @RequestParam(required = false) String caption, @RequestParam(required = false) UUID roomTypeId) {
        try {
            return hotels.uploadImage(hotelId, file.getBytes(), caption, roomTypeId);
        } catch (IOException ex) {
            throw new UncheckedIOException("Could not read upload", ex);
        }
    }

    @PatchMapping("/{hotelId}/images/{imageId}")
    @Operation(summary = "Change caption, order, cover or room type of a photo")
    public ImageItem updateImage(@PathVariable UUID hotelId, @PathVariable UUID imageId,
            @Valid @RequestBody UpdateImageRequest request) {
        return hotels.updateImage(hotelId, imageId, request);
    }

    @DeleteMapping("/{hotelId}/images/{imageId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete a photo")
    public void deleteImage(@PathVariable UUID hotelId, @PathVariable UUID imageId) {
        hotels.deleteImage(hotelId, imageId);
    }

    @GetMapping("/{hotelId}/room-types")
    @Operation(summary = "Room types with their rate plans and seasonal prices")
    public List<RoomTypeItem> roomTypes(@PathVariable UUID hotelId) {
        return rooms.roomTypes(hotelId);
    }

    @PostMapping("/{hotelId}/room-types")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Add a room type (its nights are created for the next 365 days)")
    public RoomTypeItem createRoomType(@PathVariable UUID hotelId, @Valid @RequestBody RoomTypeRequest request) {
        return rooms.createRoomType(hotelId, request);
    }

    @PutMapping("/{hotelId}/room-types/{roomTypeId}")
    @Operation(summary = "Change a room type; a new room count applies to all future nights")
    public RoomTypeItem updateRoomType(@PathVariable UUID hotelId, @PathVariable UUID roomTypeId,
            @Valid @RequestBody RoomTypeRequest request) {
        return rooms.updateRoomType(hotelId, roomTypeId, request);
    }

    @PostMapping("/{hotelId}/room-types/{roomTypeId}/rate-plans")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Add a rate plan (price, breakfast, cancellation terms)")
    public RatePlanItem createRatePlan(@PathVariable UUID hotelId, @PathVariable UUID roomTypeId,
            @Valid @RequestBody RatePlanRequest request) {
        return rooms.createRatePlan(hotelId, roomTypeId, request);
    }

    @PutMapping("/{hotelId}/room-types/{roomTypeId}/rate-plans/{ratePlanId}")
    @Operation(summary = "Change a rate plan")
    public RatePlanItem updateRatePlan(@PathVariable UUID hotelId, @PathVariable UUID roomTypeId,
            @PathVariable UUID ratePlanId, @Valid @RequestBody RatePlanRequest request) {
        return rooms.updateRatePlan(hotelId, roomTypeId, ratePlanId, request);
    }

    @PostMapping("/{hotelId}/room-types/{roomTypeId}/rate-plans/{ratePlanId}/seasonal-rates")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Add a seasonal price (overrides the base price on those nights)")
    public SeasonalRateItem addSeasonalRate(@PathVariable UUID hotelId, @PathVariable UUID roomTypeId,
            @PathVariable UUID ratePlanId, @Valid @RequestBody SeasonalRateRequest request) {
        return rooms.addSeasonalRate(hotelId, roomTypeId, ratePlanId, request);
    }

    @DeleteMapping("/{hotelId}/room-types/{roomTypeId}/rate-plans/{ratePlanId}/seasonal-rates/{seasonalRateId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete a seasonal price")
    public void deleteSeasonalRate(@PathVariable UUID hotelId, @PathVariable UUID roomTypeId,
            @PathVariable UUID ratePlanId, @PathVariable UUID seasonalRateId) {
        rooms.deleteSeasonalRate(hotelId, roomTypeId, ratePlanId, seasonalRateId);
    }

    @GetMapping("/{hotelId}/inventory")
    @Operation(summary = "Inventory calendar (max 93 days): rooms for sale, booked, held, stop-sell and price per night")
    public InventoryCalendar inventory(@PathVariable UUID hotelId, @RequestParam LocalDate from,
            @RequestParam LocalDate to) {
        return inventory.calendar(hotelId, from, to);
    }

    @GetMapping("/{hotelId}/reviews/summary")
    @Operation(summary = "Average rating, counts per star, positive and negative reviews and the last 12 months")
    public ManagerReviewSummary reviewSummary(@PathVariable UUID hotelId) {
        return reviews.summary(hotelId);
    }

    @GetMapping("/{hotelId}/reviews")
    @Operation(summary = "The hotel's reviews in any status (read only); filter by status or stars, sort",
            description = "sort = newest (default), oldest, highest or lowest rated first.")
    public PageResponse<ManagerReview> reviews(@PathVariable UUID hotelId,
            @RequestParam(required = false) ReviewStatus status, @RequestParam(required = false) Integer rating,
            @RequestParam(required = false) String sort, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return reviews.hotelReviews(hotelId, status, rating, sort, page, size);
    }

    @PutMapping("/{hotelId}/inventory")
    @Operation(summary = "Change rooms for sale and/or stop-sell for a range of nights")
    public InventoryCalendar updateInventory(@PathVariable UUID hotelId,
            @Valid @RequestBody UpdateInventoryRequest request) {
        return inventory.update(hotelId, request);
    }
}
