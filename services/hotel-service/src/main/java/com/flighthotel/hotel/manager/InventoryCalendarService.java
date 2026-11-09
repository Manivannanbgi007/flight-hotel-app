package com.flighthotel.hotel.manager;

import static java.time.temporal.ChronoUnit.DAYS;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.hotel.dto.ManagerDtos.InventoryCalendar;
import com.flighthotel.hotel.dto.ManagerDtos.InventoryDay;
import com.flighthotel.hotel.dto.ManagerDtos.RoomTypeCalendar;
import com.flighthotel.hotel.dto.ManagerDtos.UpdateInventoryRequest;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.entity.SalesStatus;
import com.flighthotel.hotel.entity.SeasonalRate;
import com.flighthotel.hotel.inventory.InventoryService;
import com.flighthotel.hotel.inventory.InventoryService.InventoryNight;
import com.flighthotel.hotel.messaging.CatalogEvents;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.repository.SeasonalRateRepository;
import com.flighthotel.hotel.staff.HotelAccess;

/** The manager's inventory calendar: rooms for sale, booked, held and stop-sell per night, with the night's price. */
@Service
@PreAuthorize("hasAnyAuthority('HOTEL_MANAGE_ANY', 'HOTEL_MANAGE_ASSIGNED')")
public class InventoryCalendarService {

    static final int MAX_CALENDAR_DAYS = 93;

    private final RoomTypeRepository roomTypes;
    private final RatePlanRepository ratePlans;
    private final SeasonalRateRepository seasonalRates;
    private final InventoryService inventory;
    private final HotelAccess access;
    private final CatalogEvents events;

    public InventoryCalendarService(RoomTypeRepository roomTypes, RatePlanRepository ratePlans,
            SeasonalRateRepository seasonalRates, InventoryService inventory, HotelAccess access, CatalogEvents events) {
        this.roomTypes = roomTypes;
        this.ratePlans = ratePlans;
        this.seasonalRates = seasonalRates;
        this.inventory = inventory;
        this.access = access;
        this.events = events;
    }

    @Transactional(readOnly = true)
    public InventoryCalendar calendar(UUID hotelId, LocalDate from, LocalDate to) {
        access.requireManage(hotelId);
        if (to.isBefore(from) || DAYS.between(from, to) >= MAX_CALENDAR_DAYS) {
            throw new BusinessRuleException("INVALID_DATE_RANGE",
                    "Choose a range of 1 to " + MAX_CALENDAR_DAYS + " days.");
        }
        List<RoomType> rooms = roomTypes.findByHotelIdOrderBySortOrderAscNameAsc(hotelId);
        List<UUID> roomIds = rooms.stream().map(RoomType::getId).toList();
        Map<UUID, List<InventoryNight>> nights = inventory.calendar(roomIds, from, to).stream()
                .collect(Collectors.groupingBy(InventoryNight::roomTypeId));
        Map<UUID, List<RatePlan>> plans = roomIds.isEmpty() ? Map.of()
                : ratePlans.findByRoomTypeIdInAndStatus(roomIds, SalesStatus.ACTIVE).stream()
                        .collect(Collectors.groupingBy(RatePlan::getRoomTypeId));
        List<UUID> planIds = plans.values().stream().flatMap(List::stream).map(RatePlan::getId).toList();
        Map<UUID, List<SeasonalRate>> seasons = planIds.isEmpty() ? Map.of()
                : seasonalRates.findOverlapping(planIds, from, to.plusDays(1)).stream()
                        .collect(Collectors.groupingBy(SeasonalRate::getRatePlanId));

        List<RoomTypeCalendar> calendars = new ArrayList<>();
        for (RoomType room : rooms) {
            List<RatePlan> roomPlans = plans.getOrDefault(room.getId(), List.of());
            List<InventoryDay> days = nights.getOrDefault(room.getId(), List.of()).stream()
                    .map(night -> new InventoryDay(night.date(), night.totalRooms(), night.bookedRooms(),
                            night.heldRooms(), night.freeRooms(), night.stopSell(),
                            lowestPrice(roomPlans, seasons, night.date())))
                    .toList();
            calendars.add(new RoomTypeCalendar(room.getId(), room.getName(), room.getTotalRooms(), room.getStatus(), days));
        }
        return new InventoryCalendar(from, to, inventory.lastSellableNight(), calendars);
    }

    @Transactional
    public InventoryCalendar update(UUID hotelId, UpdateInventoryRequest request) {
        access.requireManage(hotelId);
        roomTypes.findByIdAndHotelId(request.roomTypeId(), hotelId)
                .orElseThrow(() -> new ResourceNotFoundException("Room type", request.roomTypeId()));
        if (request.totalRooms() == null && request.stopSell() == null) {
            throw new BusinessRuleException("NOTHING_TO_CHANGE", "Give the number of rooms and/or stop-sell.");
        }
        LocalDate today = inventory.today();
        if (request.to().isBefore(request.from()) || request.from().isBefore(today)
                || request.to().isAfter(inventory.lastSellableNight())) {
            throw new BusinessRuleException("INVALID_DATE_RANGE",
                    "Choose nights from today until " + inventory.lastSellableNight() + ".");
        }
        inventory.updateNights(request.roomTypeId(), request.from(), request.to(), request.totalRooms(), request.stopSell());
        events.inventoryChanged(hotelId);
        LocalDate calendarTo = request.to().isAfter(request.from().plusDays(MAX_CALENDAR_DAYS - 1))
                ? request.from().plusDays(MAX_CALENDAR_DAYS - 1) : request.to();
        return calendar(hotelId, request.from(), calendarTo);
    }

    /** Lowest price any plan on sale asks for this night (seasonal price wins over base price). */
    private static BigDecimal lowestPrice(List<RatePlan> plans, Map<UUID, List<SeasonalRate>> seasons, LocalDate night) {
        return plans.stream()
                .map(plan -> seasons.getOrDefault(plan.getId(), List.of()).stream()
                        .filter(rate -> rate.covers(night))
                        .max(Comparator.comparingInt(SeasonalRate::getPriority)
                                .thenComparing(SeasonalRate::getCreatedAt))
                        .map(SeasonalRate::getPricePerNight)
                        .orElse(plan.getBasePricePerNight()))
                .min(Comparator.naturalOrder())
                .orElse(null);
    }
}
