package com.flighthotel.hotel.search;

import static java.time.temporal.ChronoUnit.DAYS;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.hotel.dto.PublicHotelDtos.AmenityResponse;
import com.flighthotel.hotel.dto.PublicHotelDtos.HotelDetails;
import com.flighthotel.hotel.dto.PublicHotelDtos.ImageResponse;
import com.flighthotel.hotel.dto.PublicHotelDtos.LandmarkDistance;
import com.flighthotel.hotel.dto.PublicHotelDtos.NightlyPrice;
import com.flighthotel.hotel.dto.PublicHotelDtos.PolicyResponse;
import com.flighthotel.hotel.dto.PublicHotelDtos.RateOffer;
import com.flighthotel.hotel.dto.PublicHotelDtos.RoomOffer;
import com.flighthotel.hotel.dto.PublicHotelDtos.RoomTypeSummary;
import com.flighthotel.hotel.dto.PublicHotelDtos.RoomsResponse;
import com.flighthotel.hotel.dto.PublicHotelDtos.Stay;
import com.flighthotel.hotel.entity.Amenity;
import com.flighthotel.hotel.entity.DataSource;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelImage;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.pricing.PricingService;
import com.flighthotel.hotel.pricing.PricingService.CancellationTerms;
import com.flighthotel.hotel.repository.HotelImageRepository;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.search.OfferCalculator.PricedPlan;
import com.flighthotel.hotel.search.OfferCalculator.RoomOfferData;

/** Hotel details page and the rooms/prices for a stay. Only ACTIVE hotels are public. */
@Service
public class HotelDetailsService {

    private final HotelRepository hotels;
    private final RoomTypeRepository roomTypes;
    private final HotelImageRepository images;
    private final LandmarkStore landmarks;
    private final OfferCalculator offers;
    private final PricingService pricing;
    private final StayValidator stayValidator;

    public HotelDetailsService(HotelRepository hotels, RoomTypeRepository roomTypes, HotelImageRepository images,
            LandmarkStore landmarks, OfferCalculator offers, PricingService pricing, StayValidator stayValidator) {
        this.hotels = hotels;
        this.roomTypes = roomTypes;
        this.images = images;
        this.landmarks = landmarks;
        this.offers = offers;
        this.pricing = pricing;
        this.stayValidator = stayValidator;
    }

    /** @param idOrSlug the hotel's UUID or its URL name */
    @Transactional(readOnly = true)
    public HotelDetails details(String idOrSlug) {
        Hotel hotel = findActive(idOrSlug);
        List<HotelImage> hotelImages = images.findByHotelIdOrderBySortOrderAscCreatedAtAsc(hotel.getId());
        List<RoomType> rooms = roomTypes.findByHotelIdOrderBySortOrderAscNameAsc(hotel.getId()).stream()
                .filter(RoomType::isOnSale).toList();
        Double lat = hotel.getLatitude() == null ? null : hotel.getLatitude().doubleValue();
        Double lon = hotel.getLongitude() == null ? null : hotel.getLongitude().doubleValue();
        List<LandmarkDistance> nearby = lat == null || lon == null ? List.of()
                : landmarks.inCity(hotel.getCity()).stream()
                        .map(l -> new LandmarkDistance(l.name(), l.type(),
                                BigDecimal.valueOf(l.distanceKmTo(lat, lon)).setScale(1, RoundingMode.HALF_UP).doubleValue()))
                        .sorted(Comparator.comparingDouble(LandmarkDistance::distanceKm))
                        .toList();
        return new HotelDetails(hotel.getId(), hotel.getSlug(), hotel.getName(), hotel.getDescription(),
                hotel.getPropertyType(), hotel.getStarRating(), hotel.getAvgRating(), hotel.getReviewCount(),
                hotel.getAddressLine(), hotel.getCity(), hotel.getState(), hotel.getCountryCode(), hotel.getPostalCode(),
                lat, lon, hotel.getCheckInTime(), hotel.getCheckOutTime(), hotel.getTimeZone(),
                amenities(hotel.getAmenities().stream().toList()),
                hotel.getPolicies().stream().map(p -> new PolicyResponse(p.getPolicyType(), p.getDescription())).toList(),
                hotelImages.stream().filter(img -> img.getRoomTypeId() == null).map(HotelDetailsService::image).toList(),
                rooms.stream().map(room -> summary(room, hotelImages)).toList(),
                nearby,
                hotel.getDataSource() == DataSource.DEMO);
    }

    /** Every room type on sale with its availability and the price of each plan for the stay. */
    @Transactional(readOnly = true)
    public RoomsResponse rooms(UUID hotelId, Stay stay) {
        stayValidator.validate(stay);
        Hotel hotel = findActive(hotelId.toString());
        List<HotelImage> hotelImages = images.findByHotelIdOrderBySortOrderAscCreatedAtAsc(hotelId);
        List<RoomOfferData> roomOffers = offers.offers(List.of(hotelId), stay).getOrDefault(hotelId, List.of());
        List<RoomOffer> result = roomOffers.stream()
                .sorted(Comparator.comparing((RoomOfferData o) -> !o.available())
                        .thenComparing(o -> o.plans().getFirst().price().total()))
                .map(offer -> new RoomOffer(summary(offer.roomType(), hotelImages), offer.fits(), offer.freeRooms(),
                        offer.available(), offer.plans().stream().map(plan -> rate(plan, hotel, stay)).toList()))
                .toList();
        return new RoomsResponse(hotelId, stay.checkIn(), stay.checkOut(), (int) DAYS.between(stay.checkIn(), stay.checkOut()),
                stay.rooms(), stay.adults(), stay.children(), result);
    }

    /** A published hotel by id or URL name; {@code 404 HOTEL_NOT_FOUND} for unknown or unpublished ones. */
    public Hotel findActive(String idOrSlug) {
        Optional<Hotel> hotel = parseUuid(idOrSlug).flatMap(hotels::findWithDetailsById)
                .or(() -> hotels.findWithDetailsBySlug(idOrSlug));
        return hotel.filter(Hotel::isActive).orElseThrow(() -> new ResourceNotFoundException("Hotel", idOrSlug));
    }

    private RateOffer rate(PricedPlan priced, Hotel hotel, Stay stay) {
        CancellationTerms terms = pricing.cancellation(priced.plan(), hotel, stay.checkIn());
        return new RateOffer(priced.plan().getId(), priced.plan().getName(), priced.plan().isBreakfastIncluded(),
                priced.plan().isRefundable(), terms.freeCancellation(), terms.freeUntil(), terms.description(),
                priced.price().pricePerNight(), priced.price().subtotal(), priced.price().taxes(), priced.price().total(),
                priced.price().currency(),
                priced.price().nights().stream().map(n -> new NightlyPrice(n.date(), n.price(), n.season())).toList());
    }

    static RoomTypeSummary summary(RoomType room, List<HotelImage> hotelImages) {
        return new RoomTypeSummary(room.getId(), room.getName(), room.getDescription(), room.getMaxAdults(),
                room.getMaxChildren(), room.getBedConfiguration(), room.getSizeSqm(),
                amenities(room.getAmenities().stream().toList()),
                hotelImages.stream().filter(img -> room.getId().equals(img.getRoomTypeId()))
                        .map(HotelDetailsService::image).toList());
    }

    static List<AmenityResponse> amenities(List<Amenity> list) {
        return list.stream().sorted(Comparator.comparing(Amenity::getName))
                .map(a -> new AmenityResponse(a.getCode(), a.getName(), a.getCategory().name())).toList();
    }

    static ImageResponse image(HotelImage image) {
        return new ImageResponse(image.getId(), ImageUrls.large(image.getId()), ImageUrls.thumb(image.getId()),
                image.getCaption(), image.getRoomTypeId(), image.getWidth(), image.getHeight());
    }

    private static Optional<UUID> parseUuid(String value) {
        try {
            return Optional.of(UUID.fromString(value));
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }

}
