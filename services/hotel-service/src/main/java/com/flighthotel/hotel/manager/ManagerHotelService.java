package com.flighthotel.hotel.manager;

import java.time.Clock;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.image.ImageProcessor;
import com.flighthotel.common.image.ImageProcessor.ProcessedImage;
import com.flighthotel.common.persistence.SecurityAuditorAware;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.storage.FileStorage;
import com.flighthotel.hotel.dto.ManagerDtos.HotelProfile;
import com.flighthotel.hotel.dto.ManagerDtos.HotelSummary;
import com.flighthotel.hotel.dto.ManagerDtos.ImageItem;
import com.flighthotel.hotel.dto.ManagerDtos.UpdateHotelProfileRequest;
import com.flighthotel.hotel.dto.ManagerDtos.UpdateImageRequest;
import com.flighthotel.hotel.entity.AmenityCategory;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelImage;
import com.flighthotel.hotel.entity.HotelPolicy;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.messaging.CatalogEvents;
import com.flighthotel.hotel.repository.HotelImageRepository;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.search.ImageUrls;
import com.flighthotel.hotel.staff.HotelAccess;
import com.flighthotel.hotel.staff.HotelStaffStore;

/** Hotel profile and photos for hotel managers (assigned hotels) and admins (all hotels). */
@Service
@PreAuthorize("hasAnyAuthority('HOTEL_MANAGE_ANY', 'HOTEL_MANAGE_ASSIGNED')")
public class ManagerHotelService {

    static final int MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    static final int LARGE = 1600;
    static final int THUMB = 480;
    static final int MAX_IMAGES = 40;
    private static final Logger log = LoggerFactory.getLogger(ManagerHotelService.class);

    private final HotelRepository hotels;
    private final RoomTypeRepository roomTypes;
    private final HotelImageRepository images;
    private final HotelAccess access;
    private final HotelStaffStore staff;
    private final CatalogSupport support;
    private final CatalogEvents events;
    private final ImageProcessor imageProcessor;
    private final FileStorage fileStorage;
    private final Clock clock;

    public ManagerHotelService(HotelRepository hotels, RoomTypeRepository roomTypes, HotelImageRepository images,
            HotelAccess access, HotelStaffStore staff, CatalogSupport support, CatalogEvents events,
            ImageProcessor imageProcessor, FileStorage fileStorage, Clock clock) {
        this.hotels = hotels;
        this.roomTypes = roomTypes;
        this.images = images;
        this.access = access;
        this.staff = staff;
        this.support = support;
        this.events = events;
        this.imageProcessor = imageProcessor;
        this.fileStorage = fileStorage;
        this.clock = clock;
    }

    /** Hotels the user manages (admins: every hotel). */
    @Transactional(readOnly = true)
    public List<HotelSummary> myHotels() {
        AuthenticatedUser user = CurrentUser.require();
        List<Hotel> list = access.canManageAny() ? hotels.findAll()
                : hotels.findAllById(staff.hotelIdsOf(user.id()));
        return summaries(list);
    }

    @Transactional(readOnly = true)
    public HotelProfile profile(UUID hotelId) {
        access.requireManage(hotelId);
        return ManagerMapper.profile(load(hotelId), images.findByHotelIdOrderBySortOrderAscCreatedAtAsc(hotelId));
    }

    @Transactional
    public HotelProfile updateProfile(UUID hotelId, UpdateHotelProfileRequest request) {
        access.requireManage(hotelId);
        Hotel hotel = load(hotelId);
        CatalogSupport.checkVersion(request.version(), hotel.getVersion());
        if ((request.latitude() == null) != (request.longitude() == null)) {
            throw new BusinessRuleException("INCOMPLETE_LOCATION", "Give both latitude and longitude, or neither.");
        }
        hotel.setName(request.name().trim());
        hotel.setDescription(blankToNull(request.description()));
        hotel.setPropertyType(request.propertyType());
        hotel.setStarRating(request.starRating());
        hotel.setAddressLine(request.addressLine().trim());
        hotel.setCity(request.city().trim());
        hotel.setState(blankToNull(request.state()));
        hotel.setCountryCode(request.countryCode());
        hotel.setPostalCode(blankToNull(request.postalCode()));
        hotel.setLatitude(request.latitude());
        hotel.setLongitude(request.longitude());
        hotel.setCheckInTime(request.checkInTime());
        hotel.setCheckOutTime(request.checkOutTime());
        hotel.setContactEmail(blankToNull(request.contactEmail()));
        hotel.setContactPhone(blankToNull(request.contactPhone()));
        hotel.replaceAmenities(support.resolveAmenities(request.amenities(), AmenityCategory.HOTEL));
        hotel.replacePolicies(request.policies().stream()
                .map(p -> new HotelPolicy(p.type(), p.description().trim())).toList());
        hotels.saveAndFlush(hotel);
        events.catalogChanged(hotelId, hotel.getStatus());
        return ManagerMapper.profile(hotel, images.findByHotelIdOrderBySortOrderAscCreatedAtAsc(hotelId));
    }

    // ------------------------------------------------------------------ photos

    /** Re-encoded twice (large + thumbnail). The first photo becomes the cover. */
    @Transactional
    public ImageItem uploadImage(UUID hotelId, byte[] content, String caption, UUID roomTypeId) {
        AuthenticatedUser user = access.requireManage(hotelId);
        if (images.countByHotelId(hotelId) >= MAX_IMAGES) {
            throw new BusinessRuleException("IMAGE_LIMIT_REACHED", "A hotel can have at most " + MAX_IMAGES + " photos.");
        }
        if (roomTypeId != null) {
            requireRoomType(hotelId, roomTypeId);
        }
        List<ProcessedImage> versions = imageProcessor.process(content, MAX_IMAGE_BYTES, LARGE, THUMB);
        String largeKey = fileStorage.store("hotel-images", "jpg", versions.get(0).jpeg());
        String thumbKey = fileStorage.store("hotel-images", "jpg", versions.get(1).jpeg());
        deleteFilesOnRollback(List.of(largeKey, thumbKey));

        HotelImage image = new HotelImage(hotelId, largeKey, thumbKey, versions.get(0).width(), versions.get(0).height(),
                clock.instant(), user.id().toString());
        image.setCaption(blankToNull(caption));
        image.setRoomTypeId(roomTypeId);
        long existing = images.countByHotelId(hotelId);
        image.setSortOrder((int) existing);
        image.setCover(existing == 0 && roomTypeId == null);
        images.saveAndFlush(image);
        events.catalogChanged(hotelId, load(hotelId).getStatus());
        return ManagerMapper.image(image);
    }

    @Transactional
    public ImageItem updateImage(UUID hotelId, UUID imageId, UpdateImageRequest request) {
        access.requireManage(hotelId);
        HotelImage image = images.findByIdAndHotelId(imageId, hotelId)
                .orElseThrow(() -> new ResourceNotFoundException("Image", imageId));
        if (request.caption() != null) {
            image.setCaption(blankToNull(request.caption()));
        }
        if (request.sortOrder() != null) {
            image.setSortOrder(request.sortOrder());
        }
        if (Boolean.TRUE.equals(request.clearRoomType())) {
            image.setRoomTypeId(null);
        } else if (request.roomTypeId() != null) {
            requireRoomType(hotelId, request.roomTypeId());
            image.setRoomTypeId(request.roomTypeId());
        }
        if (Boolean.TRUE.equals(request.cover())) {
            // Exactly one cover per hotel.
            images.findByHotelIdOrderBySortOrderAscCreatedAtAsc(hotelId).forEach(other -> other.setCover(false));
            image.setCover(true);
        }
        images.flush();
        events.catalogChanged(hotelId, load(hotelId).getStatus());
        return ManagerMapper.image(image);
    }

    @Transactional
    public void deleteImage(UUID hotelId, UUID imageId) {
        access.requireManage(hotelId);
        HotelImage image = images.findByIdAndHotelId(imageId, hotelId)
                .orElseThrow(() -> new ResourceNotFoundException("Image", imageId));
        images.delete(image);
        images.flush();
        if (image.isCover()) {
            images.findByHotelIdOrderBySortOrderAscCreatedAtAsc(hotelId).stream()
                    .filter(other -> other.getRoomTypeId() == null).findFirst()
                    .ifPresent(next -> next.setCover(true));
        }
        deleteFilesAfterCommit(List.of(image.getStorageKey(), image.getThumbKey()));
        events.catalogChanged(hotelId, load(hotelId).getStatus());
    }

    // ------------------------------------------------------------------ helpers

    /** Card data for a list of hotels (public: called through the Spring proxy by AdminHotelService). */
    public List<HotelSummary> summaries(List<Hotel> list) {
        Collection<UUID> ids = list.stream().map(Hotel::getId).toList();
        Map<UUID, Long> roomCounts = ids.isEmpty() ? Map.of() : roomTypes.findByHotelIdInAndStatus(ids,
                        com.flighthotel.hotel.entity.SalesStatus.ACTIVE).stream()
                .collect(Collectors.groupingBy(RoomType::getHotelId, Collectors.counting()));
        Map<UUID, Long> roomTotals = ids.isEmpty() ? Map.of() : roomTypes.findByHotelIdInAndStatus(ids,
                        com.flighthotel.hotel.entity.SalesStatus.ACTIVE).stream()
                .collect(Collectors.groupingBy(RoomType::getHotelId, Collectors.summingLong(RoomType::getTotalRooms)));
        Map<UUID, HotelImage> covers = ids.isEmpty() ? Map.of() : images.findByHotelIdInAndCoverTrue(ids).stream()
                .collect(Collectors.toMap(HotelImage::getHotelId, Function.identity(), (a, b) -> a));
        List<HotelSummary> result = new ArrayList<>();
        for (Hotel hotel : list.stream().sorted((a, b) -> a.getName().compareToIgnoreCase(b.getName())).toList()) {
            HotelImage cover = covers.get(hotel.getId());
            result.add(new HotelSummary(hotel.getId(), hotel.getName(), hotel.getSlug(), hotel.getCity(),
                    hotel.getCountryCode(), hotel.getStatus(), hotel.getDataSource(), hotel.getStarRating(),
                    cover == null ? null : ImageUrls.thumb(cover.getId()), roomCounts.getOrDefault(hotel.getId(), 0L),
                    roomTotals.getOrDefault(hotel.getId(), 0L), staff.countFor(hotel.getId()), hotel.getUpdatedAt()));
        }
        return result;
    }

    private Hotel load(UUID hotelId) {
        return hotels.findWithDetailsById(hotelId).orElseThrow(() -> new ResourceNotFoundException("Hotel", hotelId));
    }

    private void requireRoomType(UUID hotelId, UUID roomTypeId) {
        roomTypes.findByIdAndHotelId(roomTypeId, hotelId)
                .orElseThrow(() -> new ResourceNotFoundException("Room type", roomTypeId));
    }

    private void deleteFilesOnRollback(List<String> keys) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status != STATUS_COMMITTED) {
                    deleteQuietly(keys);
                }
            }
        });
    }

    private void deleteFilesAfterCommit(List<String> keys) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                deleteQuietly(keys);
            }
        });
    }

    private void deleteQuietly(List<String> keys) {
        for (String key : keys) {
            try {
                fileStorage.delete(key);
            } catch (RuntimeException ex) {
                log.warn("Could not delete hotel image file key={}", key, ex);
            }
        }
    }

    static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    static String actor() {
        return CurrentUser.get().map(user -> user.id().toString()).orElse(SecurityAuditorAware.SYSTEM);
    }

}
