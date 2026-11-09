package com.flighthotel.hotel.manager;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.security.Roles;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.hotel.dto.ManagerDtos.ChangeHotelStatusRequest;
import com.flighthotel.hotel.dto.ManagerDtos.CreateHotelRequest;
import com.flighthotel.hotel.dto.ManagerDtos.HotelSummary;
import com.flighthotel.hotel.dto.ManagerDtos.ManagerItem;
import com.flighthotel.hotel.entity.DataSource;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.entity.SalesStatus;
import com.flighthotel.hotel.messaging.CatalogEvents;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.search.HotelIndexer;
import com.flighthotel.hotel.staff.HotelStaffStore;
import com.flighthotel.hotel.staff.KnownUserStore;
import com.flighthotel.hotel.staff.KnownUserStore.KnownUser;

import jakarta.persistence.criteria.Predicate;

/** Admin: create hotels, publish/unpublish them, assign hotel managers (assumption A14), rebuild the search index. */
@Service
@PreAuthorize("hasRole('ADMIN')")
public class AdminHotelService {

    private static final int MAX_PAGE_SIZE = 100;

    private final HotelRepository hotels;
    private final RoomTypeRepository roomTypes;
    private final RatePlanRepository ratePlans;
    private final HotelStaffStore staff;
    private final KnownUserStore users;
    private final ManagerHotelService managerHotels;
    private final CatalogSupport support;
    private final CatalogEvents events;
    private final AuditPublisher audit;
    private final HotelIndexer indexer;
    private final Clock clock;

    public AdminHotelService(HotelRepository hotels, RoomTypeRepository roomTypes, RatePlanRepository ratePlans,
            HotelStaffStore staff, KnownUserStore users, ManagerHotelService managerHotels, CatalogSupport support,
            CatalogEvents events, AuditPublisher audit, HotelIndexer indexer, Clock clock) {
        this.hotels = hotels;
        this.roomTypes = roomTypes;
        this.ratePlans = ratePlans;
        this.staff = staff;
        this.users = users;
        this.managerHotels = managerHotels;
        this.support = support;
        this.events = events;
        this.audit = audit;
        this.indexer = indexer;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public PageResponse<HotelSummary> list(String search, HotelStatus status, Pageable pageable) {
        Specification<Hotel> filter = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (search != null && !search.isBlank()) {
                String pattern = "%" + search.trim().toLowerCase(Locale.ROOT).replace("%", "\\%").replace("_", "\\_") + "%";
                predicates.add(cb.or(cb.like(cb.lower(root.get("name")), pattern, '\\'),
                        cb.like(cb.lower(root.get("city")), pattern, '\\')));
            }
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        Pageable page = PageRequest.of(pageable.getPageNumber(), Math.min(Math.max(pageable.getPageSize(), 1), MAX_PAGE_SIZE),
                Sort.by(Sort.Order.asc("name")));
        Page<Hotel> result = hotels.findAll(filter, page);
        List<HotelSummary> summaries = managerHotels.summaries(result.getContent());
        return PageResponse.from(new PageImpl<>(summaries, page, result.getTotalElements()));
    }

    @Transactional
    public HotelSummary create(CreateHotelRequest request) {
        Hotel hotel = new Hotel(request.name().trim(), support.uniqueSlug(request.name(), request.city()),
                request.propertyType(), request.addressLine().trim(), request.city().trim(), request.countryCode(),
                DataSource.INTERNAL);
        hotel.setStarRating(request.starRating());
        hotels.saveAndFlush(hotel);
        events.catalogChanged(hotel.getId(), hotel.getStatus());
        audit.record("HOTEL_CREATED", "HOTEL", hotel.getId().toString(), Map.of("name", hotel.getName()));
        return managerHotels.summaries(List.of(hotel)).getFirst();
    }

    /**
     * Publishing needs at least one room type on sale with a plan on sale, an address and a photo, so customers
     * never see an empty hotel. Unpublishing is always allowed (existing bookings are not affected).
     */
    @Transactional
    public HotelSummary changeStatus(UUID hotelId, ChangeHotelStatusRequest request) {
        Hotel hotel = load(hotelId);
        if (request.status() == HotelStatus.DRAFT && hotel.getStatus() != HotelStatus.DRAFT) {
            throw new BusinessRuleException("INVALID_STATUS", "A published hotel can be set INACTIVE, not back to DRAFT.");
        }
        if (request.status() == HotelStatus.ACTIVE) {
            List<String> missing = missingForPublication(hotel);
            if (!missing.isEmpty()) {
                throw new BusinessRuleException("HOTEL_NOT_READY", "The hotel cannot be published yet: "
                        + String.join(", ", missing) + ".", Map.of("missing", missing));
            }
        }
        HotelStatus before = hotel.getStatus();
        hotel.changeStatus(request.status());
        hotels.saveAndFlush(hotel);
        events.catalogChanged(hotelId, hotel.getStatus());
        audit.record("HOTEL_STATUS_CHANGED", "HOTEL", hotelId.toString(),
                Map.of("from", before.name(), "to", hotel.getStatus().name()));
        return managerHotels.summaries(List.of(hotel)).getFirst();
    }

    @Transactional(readOnly = true)
    public List<ManagerItem> managers(UUID hotelId) {
        load(hotelId);
        return staff.managersOf(hotelId).stream()
                .map(m -> new ManagerItem(m.userId(), m.email(), m.firstName(), m.lastName(), m.assignedAt()))
                .toList();
    }

    /** The person must have a HOTEL_MANAGER account (created by an admin in User Management). */
    @Transactional
    public List<ManagerItem> assignManager(UUID hotelId, String email) {
        load(hotelId);
        KnownUser user = users.findByEmail(email).orElseThrow(() -> new BusinessRuleException("MANAGER_NOT_FOUND",
                "No account with this email is known yet. Create it in User Management first."));
        if (!user.hasRole(Roles.HOTEL_MANAGER)) {
            throw new BusinessRuleException("NOT_A_HOTEL_MANAGER", "This account does not have the HOTEL_MANAGER role.");
        }
        if (staff.assign(hotelId, user.userId(), CurrentUser.require().id().toString(), clock.instant())) {
            audit.record("HOTEL_MANAGER_ASSIGNED", "HOTEL", hotelId.toString(), Map.of("userId", user.userId().toString()));
        }
        return managers(hotelId);
    }

    @Transactional
    public List<ManagerItem> unassignManager(UUID hotelId, UUID userId) {
        load(hotelId);
        if (staff.unassign(hotelId, userId)) {
            audit.record("HOTEL_MANAGER_UNASSIGNED", "HOTEL", hotelId.toString(), Map.of("userId", userId.toString()));
        }
        return managers(hotelId);
    }

    /** Rebuilds the search index from MySQL (repair tool; also runs automatically when the index is incomplete). */
    public int reindex() {
        return indexer.reindexAll();
    }

    private List<String> missingForPublication(Hotel hotel) {
        List<String> missing = new ArrayList<>();
        List<RoomType> rooms = roomTypes.findByHotelIdInAndStatus(List.of(hotel.getId()), SalesStatus.ACTIVE);
        List<RatePlan> plans = rooms.isEmpty() ? List.of()
                : ratePlans.findByRoomTypeIdInAndStatus(rooms.stream().map(RoomType::getId).toList(), SalesStatus.ACTIVE);
        if (plans.isEmpty()) {
            missing.add("a room type with a rate plan on sale");
        }
        if (hotel.getLatitude() == null) {
            missing.add("the map location");
        }
        if (hotel.getDescription() == null) {
            missing.add("a description");
        }
        if (managerHotels.summaries(List.of(hotel)).getFirst().imageUrl() == null) {
            missing.add("a cover photo");
        }
        return missing;
    }

    private Hotel load(UUID hotelId) {
        return hotels.findById(hotelId).orElseThrow(() -> new ResourceNotFoundException("Hotel", hotelId));
    }
}
