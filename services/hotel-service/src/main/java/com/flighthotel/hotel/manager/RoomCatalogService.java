package com.flighthotel.hotel.manager;

import java.math.BigDecimal;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.hotel.dto.ManagerDtos.RatePlanItem;
import com.flighthotel.hotel.dto.ManagerDtos.RatePlanRequest;
import com.flighthotel.hotel.dto.ManagerDtos.RoomTypeItem;
import com.flighthotel.hotel.dto.ManagerDtos.RoomTypeRequest;
import com.flighthotel.hotel.dto.ManagerDtos.SeasonalRateItem;
import com.flighthotel.hotel.dto.ManagerDtos.SeasonalRateRequest;
import com.flighthotel.hotel.entity.AmenityCategory;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.entity.SeasonalRate;
import com.flighthotel.hotel.inventory.InventoryService;
import com.flighthotel.hotel.messaging.CatalogEvents;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.repository.SeasonalRateRepository;
import com.flighthotel.hotel.staff.HotelAccess;

/**
 * Room types, rate plans and seasonal prices. Nothing is deleted (bookings will refer to these rows): room types and
 * plans are switched to INACTIVE instead. Seasonal prices can be deleted.
 */
@Service
@PreAuthorize("hasAnyAuthority('HOTEL_MANAGE_ANY', 'HOTEL_MANAGE_ASSIGNED')")
public class RoomCatalogService {

    /** Seasonal prices can be planned up to two years ahead. */
    private static final int MAX_SEASON_YEARS = 2;

    private final HotelRepository hotels;
    private final RoomTypeRepository roomTypes;
    private final RatePlanRepository ratePlans;
    private final SeasonalRateRepository seasonalRates;
    private final InventoryService inventory;
    private final HotelAccess access;
    private final CatalogSupport support;
    private final CatalogEvents events;
    private final Clock clock;

    public RoomCatalogService(HotelRepository hotels, RoomTypeRepository roomTypes, RatePlanRepository ratePlans,
            SeasonalRateRepository seasonalRates, InventoryService inventory, HotelAccess access, CatalogSupport support,
            CatalogEvents events, Clock clock) {
        this.hotels = hotels;
        this.roomTypes = roomTypes;
        this.ratePlans = ratePlans;
        this.seasonalRates = seasonalRates;
        this.inventory = inventory;
        this.access = access;
        this.support = support;
        this.events = events;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<RoomTypeItem> roomTypes(UUID hotelId) {
        access.requireManage(hotelId);
        List<RoomType> rooms = roomTypes.findByHotelIdOrderBySortOrderAscNameAsc(hotelId);
        List<UUID> roomIds = rooms.stream().map(RoomType::getId).toList();
        Map<UUID, List<RatePlan>> plans = roomIds.isEmpty() ? Map.of()
                : ratePlans.findByRoomTypeIdInOrderByBasePricePerNightAsc(roomIds).stream()
                        .collect(Collectors.groupingBy(RatePlan::getRoomTypeId));
        List<UUID> planIds = plans.values().stream().flatMap(List::stream).map(RatePlan::getId).toList();
        Map<UUID, List<SeasonalRate>> seasons = planIds.isEmpty() ? Map.of()
                : planIds.stream().flatMap(id -> seasonalRates.findByRatePlanIdOrderByStartDateAsc(id).stream())
                        .collect(Collectors.groupingBy(SeasonalRate::getRatePlanId));
        return rooms.stream()
                .map(room -> ManagerMapper.roomType(room, plans.getOrDefault(room.getId(), List.of()), seasons))
                .toList();
    }

    @Transactional
    public RoomTypeItem createRoomType(UUID hotelId, RoomTypeRequest request) {
        access.requireManage(hotelId);
        RoomType room = new RoomType(hotelId);
        apply(room, request);
        room.setTotalRooms(request.totalRooms());
        roomTypes.saveAndFlush(room);
        inventory.initialize(room.getId(), request.totalRooms());
        changed(hotelId);
        return ManagerMapper.roomType(room, List.of(), Map.of());
    }

    @Transactional
    public RoomTypeItem updateRoomType(UUID hotelId, UUID roomTypeId, RoomTypeRequest request) {
        access.requireManage(hotelId);
        RoomType room = loadRoomType(hotelId, roomTypeId);
        CatalogSupport.checkVersion(request.version(), room.getVersion());
        apply(room, request);
        if (request.totalRooms() != room.getTotalRooms()) {
            // Applies to every future night; refused (409) where more rooms are already booked or held.
            inventory.updateNights(roomTypeId, inventory.today(), inventory.lastSellableNight(), request.totalRooms(), null);
            room.setTotalRooms(request.totalRooms());
            events.inventoryChanged(hotelId);
        }
        roomTypes.saveAndFlush(room);
        changed(hotelId);
        List<RatePlan> plans = ratePlans.findByRoomTypeIdInOrderByBasePricePerNightAsc(List.of(roomTypeId));
        return ManagerMapper.roomType(room, plans, Map.of());
    }

    @Transactional
    public RatePlanItem createRatePlan(UUID hotelId, UUID roomTypeId, RatePlanRequest request) {
        access.requireManage(hotelId);
        loadRoomType(hotelId, roomTypeId);
        RatePlan plan = new RatePlan(roomTypeId);
        apply(plan, request);
        ratePlans.saveAndFlush(plan);
        changed(hotelId);
        return ManagerMapper.ratePlan(plan, List.of());
    }

    @Transactional
    public RatePlanItem updateRatePlan(UUID hotelId, UUID roomTypeId, UUID ratePlanId, RatePlanRequest request) {
        access.requireManage(hotelId);
        loadRoomType(hotelId, roomTypeId);
        RatePlan plan = loadPlan(roomTypeId, ratePlanId);
        CatalogSupport.checkVersion(request.version(), plan.getVersion());
        apply(plan, request);
        ratePlans.saveAndFlush(plan);
        changed(hotelId);
        return ManagerMapper.ratePlan(plan, seasonalRates.findByRatePlanIdOrderByStartDateAsc(ratePlanId));
    }

    @Transactional
    public SeasonalRateItem addSeasonalRate(UUID hotelId, UUID roomTypeId, UUID ratePlanId, SeasonalRateRequest request) {
        access.requireManage(hotelId);
        loadRoomType(hotelId, roomTypeId);
        loadPlan(roomTypeId, ratePlanId);
        if (request.endDate().isBefore(request.startDate())) {
            throw new BusinessRuleException("INVALID_DATE_RANGE", "The end date must be on or after the start date.");
        }
        if (request.endDate().isBefore(inventory.today())) {
            throw new BusinessRuleException("INVALID_DATE_RANGE", "The season has already ended.");
        }
        if (request.endDate().isAfter(inventory.today().plusYears(MAX_SEASON_YEARS))) {
            throw new BusinessRuleException("INVALID_DATE_RANGE",
                    "Seasonal prices can be planned up to " + MAX_SEASON_YEARS + " years ahead.");
        }
        SeasonalRate rate = new SeasonalRate(ratePlanId, request.label().trim(), request.startDate(), request.endDate(),
                request.pricePerNight(), request.priority(), clock.instant(), ManagerHotelService.actor());
        seasonalRates.saveAndFlush(rate);
        changed(hotelId);
        events.inventoryChanged(hotelId);
        return ManagerMapper.seasonalRate(rate);
    }

    @Transactional
    public void deleteSeasonalRate(UUID hotelId, UUID roomTypeId, UUID ratePlanId, UUID seasonalRateId) {
        access.requireManage(hotelId);
        loadRoomType(hotelId, roomTypeId);
        loadPlan(roomTypeId, ratePlanId);
        SeasonalRate rate = seasonalRates.findByIdAndRatePlanId(seasonalRateId, ratePlanId)
                .orElseThrow(() -> new ResourceNotFoundException("Seasonal rate", seasonalRateId));
        seasonalRates.delete(rate);
        changed(hotelId);
        events.inventoryChanged(hotelId);
    }

    private void apply(RoomType room, RoomTypeRequest request) {
        room.setName(request.name().trim());
        room.setDescription(ManagerHotelService.blankToNull(request.description()));
        room.setMaxAdults(request.maxAdults());
        room.setMaxChildren(request.maxChildren());
        room.setBedConfiguration(request.bedConfiguration().trim());
        room.setSizeSqm(request.sizeSqm());
        room.setStatus(request.status());
        room.setSortOrder(request.sortOrder());
        room.replaceAmenities(support.resolveAmenities(request.amenities(), AmenityCategory.ROOM));
    }

    private static void apply(RatePlan plan, RatePlanRequest request) {
        if (request.refundable() && request.freeCancellationHours() == null && request.cancellationFeePercent() == null) {
            throw new BusinessRuleException("INCOMPLETE_CANCELLATION_POLICY",
                    "A refundable plan needs a free-cancellation period or a cancellation fee.");
        }
        plan.setName(request.name().trim());
        plan.setBasePricePerNight(request.basePricePerNight());
        plan.setBreakfastIncluded(request.breakfastIncluded());
        plan.setStatus(request.status());
        plan.setCancellation(request.refundable(), request.freeCancellationHours(),
                request.cancellationFeePercent() == null ? BigDecimal.valueOf(100) : request.cancellationFeePercent());
    }

    private RoomType loadRoomType(UUID hotelId, UUID roomTypeId) {
        return roomTypes.findByIdAndHotelId(roomTypeId, hotelId)
                .orElseThrow(() -> new ResourceNotFoundException("Room type", roomTypeId));
    }

    private RatePlan loadPlan(UUID roomTypeId, UUID ratePlanId) {
        return ratePlans.findByIdAndRoomTypeId(ratePlanId, roomTypeId)
                .orElseThrow(() -> new ResourceNotFoundException("Rate plan", ratePlanId));
    }

    private void changed(UUID hotelId) {
        Hotel hotel = hotels.findById(hotelId).orElseThrow();
        events.catalogChanged(hotelId, hotel.getStatus());
    }
}
