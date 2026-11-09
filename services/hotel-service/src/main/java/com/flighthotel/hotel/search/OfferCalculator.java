package com.flighthotel.hotel.search;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;

import com.flighthotel.hotel.dto.PublicHotelDtos.Stay;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.entity.SalesStatus;
import com.flighthotel.hotel.entity.SeasonalRate;
import com.flighthotel.hotel.inventory.InventoryService;
import com.flighthotel.hotel.pricing.PricingService;
import com.flighthotel.hotel.pricing.PricingService.StayPrice;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.repository.SeasonalRateRepository;

/**
 * Turns "these hotels, this stay" into concrete offers: for every room type on sale, whether it fits the party and has
 * enough free rooms on EVERY night, and the price of each plan on sale. Few queries for many hotels (search results).
 */
@Component
public class OfferCalculator {

    private final RoomTypeRepository roomTypes;
    private final RatePlanRepository ratePlans;
    private final SeasonalRateRepository seasonalRates;
    private final InventoryService inventory;
    private final PricingService pricing;

    public OfferCalculator(RoomTypeRepository roomTypes, RatePlanRepository ratePlans,
            SeasonalRateRepository seasonalRates, InventoryService inventory, PricingService pricing) {
        this.roomTypes = roomTypes;
        this.ratePlans = ratePlans;
        this.seasonalRates = seasonalRates;
        this.inventory = inventory;
        this.pricing = pricing;
    }

    /** Offers per hotel id. Room types without a plan on sale are left out. */
    public Map<UUID, List<RoomOfferData>> offers(Collection<UUID> hotelIds, Stay stay) {
        if (hotelIds.isEmpty()) {
            return Map.of();
        }
        List<RoomType> rooms = roomTypes.findByHotelIdInAndStatus(hotelIds, SalesStatus.ACTIVE);
        List<UUID> roomIds = rooms.stream().map(RoomType::getId).toList();
        if (roomIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<RatePlan>> plansByRoom = ratePlans.findByRoomTypeIdInAndStatus(roomIds, SalesStatus.ACTIVE)
                .stream().collect(Collectors.groupingBy(RatePlan::getRoomTypeId));
        List<UUID> planIds = plansByRoom.values().stream().flatMap(List::stream).map(RatePlan::getId).toList();
        LocalDate checkIn = stay.checkIn();
        LocalDate checkOut = stay.checkOut();
        Map<UUID, List<SeasonalRate>> seasonsByPlan = planIds.isEmpty() ? Map.of()
                : seasonalRates.findOverlapping(planIds, checkIn, checkOut).stream()
                        .collect(Collectors.groupingBy(SeasonalRate::getRatePlanId));
        Map<UUID, Integer> free = inventory.freeRooms(roomIds, checkIn, checkOut);

        return rooms.stream()
                .filter(room -> plansByRoom.containsKey(room.getId()))
                .map(room -> {
                    List<PricedPlan> priced = plansByRoom.get(room.getId()).stream()
                            .map(plan -> new PricedPlan(plan, pricing.price(plan,
                                    seasonsByPlan.getOrDefault(plan.getId(), List.of()), checkIn, checkOut, stay.rooms())))
                            .sorted((a, b) -> a.price().total().compareTo(b.price().total()))
                            .toList();
                    boolean fits = room.fits(stay.rooms(), stay.adults(), stay.children());
                    int freeRooms = free.getOrDefault(room.getId(), 0);
                    return new RoomOfferData(room, fits, freeRooms, fits && freeRooms >= stay.rooms(), priced);
                })
                .collect(Collectors.groupingBy(offer -> offer.roomType().getHotelId()));
    }

    /** @param available fits the party and enough rooms are free on every night */
    public record RoomOfferData(RoomType roomType, boolean fits, int freeRooms, boolean available,
                                List<PricedPlan> plans) {
    }

    public record PricedPlan(RatePlan plan, StayPrice price) {
    }
}
