package com.flighthotel.hotel.manager;

import java.util.Comparator;
import java.util.List;
import java.util.Map;

import com.flighthotel.hotel.dto.ManagerDtos.HotelProfile;
import com.flighthotel.hotel.dto.ManagerDtos.ImageItem;
import com.flighthotel.hotel.dto.ManagerDtos.PolicyItem;
import com.flighthotel.hotel.dto.ManagerDtos.RatePlanItem;
import com.flighthotel.hotel.dto.ManagerDtos.RoomTypeItem;
import com.flighthotel.hotel.dto.ManagerDtos.SeasonalRateItem;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelImage;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.entity.SeasonalRate;
import com.flighthotel.hotel.pricing.PricingService;
import com.flighthotel.hotel.search.ImageUrls;

/** Entity → manager API mapping. Entities never leave the service layer. */
final class ManagerMapper {

    private ManagerMapper() {
    }

    static HotelProfile profile(Hotel hotel, List<HotelImage> images) {
        return new HotelProfile(hotel.getId(), hotel.getName(), hotel.getSlug(), hotel.getDescription(),
                hotel.getPropertyType(), hotel.getStarRating(), hotel.getAddressLine(), hotel.getCity(), hotel.getState(),
                hotel.getCountryCode(), hotel.getPostalCode(), hotel.getLatitude(), hotel.getLongitude(),
                hotel.getTimeZone(), hotel.getCheckInTime(), hotel.getCheckOutTime(), hotel.getContactEmail(),
                hotel.getContactPhone(), hotel.amenityCodes(),
                hotel.getPolicies().stream().map(p -> new PolicyItem(p.getPolicyType(), p.getDescription())).toList(),
                hotel.getStatus(), hotel.getDataSource(), images.stream().map(ManagerMapper::image).toList(),
                hotel.getVersion());
    }

    static ImageItem image(HotelImage image) {
        return new ImageItem(image.getId(), ImageUrls.large(image.getId()), ImageUrls.thumb(image.getId()),
                image.getCaption(), image.isCover(), image.getSortOrder(), image.getRoomTypeId(), image.getWidth(),
                image.getHeight());
    }

    static RoomTypeItem roomType(RoomType room, List<RatePlan> plans, Map<java.util.UUID, List<SeasonalRate>> seasons) {
        return new RoomTypeItem(room.getId(), room.getName(), room.getDescription(), room.getMaxAdults(),
                room.getMaxChildren(), room.getBedConfiguration(), room.getSizeSqm(), room.getTotalRooms(),
                room.getStatus(), room.getSortOrder(), room.amenityCodes(),
                plans.stream().sorted(Comparator.comparing(RatePlan::getBasePricePerNight))
                        .map(plan -> ratePlan(plan, seasons.getOrDefault(plan.getId(), List.of()))).toList(),
                room.getVersion());
    }

    static RatePlanItem ratePlan(RatePlan plan, List<SeasonalRate> seasons) {
        return new RatePlanItem(plan.getId(), plan.getRoomTypeId(), plan.getName(), plan.getBasePricePerNight(),
                plan.getCurrency(), plan.isBreakfastIncluded(), plan.isRefundable(), plan.getFreeCancellationHours(),
                plan.getCancellationFeePercent(), PricingService.summary(plan), plan.getStatus(),
                seasons.stream().sorted(Comparator.comparing(SeasonalRate::getStartDate))
                        .map(ManagerMapper::seasonalRate).toList(),
                plan.getVersion());
    }

    static SeasonalRateItem seasonalRate(SeasonalRate rate) {
        return new SeasonalRateItem(rate.getId(), rate.getLabel(), rate.getStartDate(), rate.getEndDate(),
                rate.getPricePerNight(), rate.getPriority());
    }
}
