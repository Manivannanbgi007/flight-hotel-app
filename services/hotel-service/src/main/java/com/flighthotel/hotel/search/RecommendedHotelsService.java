package com.flighthotel.hotel.search;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.hotel.dto.PublicHotelDtos.RecommendedHotel;
import com.flighthotel.hotel.entity.DataSource;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelImage;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.entity.SalesStatus;
import com.flighthotel.hotel.repository.HotelImageRepository;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;

/**
 * "Recommended hotels" on the home page (public): published hotels with the best guest rating (unrated ones last,
 * then more reviews first), with their cover photo and a "from" price. The price is the lowest base price of any
 * plan on sale, like the search document's teaser price: it is a hint, not an offer (seasonal prices and
 * availability need dates).
 */
@Service
public class RecommendedHotelsService {

    static final int MAX = 24;

    private final HotelRepository hotels;
    private final RoomTypeRepository roomTypes;
    private final RatePlanRepository ratePlans;
    private final HotelImageRepository images;

    public RecommendedHotelsService(HotelRepository hotels, RoomTypeRepository roomTypes, RatePlanRepository ratePlans,
            HotelImageRepository images) {
        this.hotels = hotels;
        this.roomTypes = roomTypes;
        this.ratePlans = ratePlans;
        this.images = images;
    }

    @Transactional(readOnly = true)
    public List<RecommendedHotel> recommended(int limit) {
        List<Hotel> found = hotels.findRecommended(PageRequest.of(0, Math.min(Math.max(limit, 1), MAX)));
        if (found.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = found.stream().map(Hotel::getId).toList();
        Map<UUID, UUID> covers = images.findByHotelIdInAndCoverTrue(ids).stream()
                .collect(Collectors.toMap(HotelImage::getHotelId, HotelImage::getId, (a, b) -> a));
        Map<UUID, UUID> hotelOfRoom = roomTypes.findByHotelIdInAndStatus(ids, SalesStatus.ACTIVE).stream()
                .collect(Collectors.toMap(RoomType::getId, RoomType::getHotelId));
        Map<UUID, BigDecimal> priceFrom = hotelOfRoom.isEmpty() ? Map.of()
                : ratePlans.findByRoomTypeIdInAndStatus(hotelOfRoom.keySet(), SalesStatus.ACTIVE).stream()
                        .collect(Collectors.toMap(plan -> hotelOfRoom.get(plan.getRoomTypeId()),
                                RatePlan::getBasePricePerNight,
                                (a, b) -> a.compareTo(b) <= 0 ? a : b));
        return found.stream()
                .map(hotel -> new RecommendedHotel(hotel.getId(), hotel.getSlug(), hotel.getName(), hotel.getCity(),
                        hotel.getStarRating(), hotel.getAvgRating(), hotel.getReviewCount(),
                        Optional.ofNullable(covers.get(hotel.getId())).map(ImageUrls::thumb).orElse(null),
                        priceFrom.get(hotel.getId()), hotel.getDataSource() == DataSource.DEMO))
                .toList();
    }
}
