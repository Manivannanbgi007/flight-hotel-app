package com.flighthotel.hotel.demo;

import java.awt.Color;
import java.awt.Font;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.MonthDay;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.common.image.ImageProcessor;
import com.flighthotel.common.persistence.SecurityAuditorAware;
import com.flighthotel.common.security.Roles;
import com.flighthotel.common.storage.FileStorage;
import com.flighthotel.hotel.entity.AmenityCategory;
import com.flighthotel.hotel.entity.DataSource;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelImage;
import com.flighthotel.hotel.entity.HotelPolicy;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.entity.PolicyType;
import com.flighthotel.hotel.entity.PropertyType;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.entity.SeasonalRate;
import com.flighthotel.hotel.inventory.InventoryService;
import com.flighthotel.hotel.manager.CatalogSupport;
import com.flighthotel.hotel.messaging.CatalogEvents;
import com.flighthotel.hotel.repository.HotelImageRepository;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.repository.SeasonalRateRepository;
import com.flighthotel.hotel.search.LandmarkStore;
import com.flighthotel.hotel.staff.HotelStaffStore;
import com.flighthotel.hotel.staff.KnownUserStore;
import com.flighthotel.hotel.staff.KnownUserStore.KnownUser;

/**
 * <b>Sample data, clearly labelled</b> (requirement: never mix demo inventory with real inventory without saying so):
 * fictional hotels in eight Indian cities with {@code data_source = DEMO}, a "Demo listing" note in the description,
 * generated placeholder photos and demo ratings. Customers see a "Demo" badge on every one of them.
 * <p>
 * Runs once (skipped when demo hotels exist). Always off in the {@code prod} profile. The demo hotel manager
 * ({@code manager@flighthotel.local}) is assigned to the first three hotels as soon as identity-service announces
 * the account.
 */
@Component
@Order(10)
@ConditionalOnProperty(prefix = "hotel.demo-data", name = "enabled", havingValue = "true")
public class DemoHotelSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoHotelSeeder.class);
    private static final int MANAGED_DEMO_HOTELS = 3;
    private static final String DEMO_NOTE = "\n\nDemo listing: sample data for trying out the site. This hotel does not exist.";

    private final HotelRepository hotels;
    private final RoomTypeRepository roomTypes;
    private final RatePlanRepository ratePlans;
    private final SeasonalRateRepository seasonalRates;
    private final HotelImageRepository images;
    private final InventoryService inventory;
    private final LandmarkStore landmarks;
    private final HotelStaffStore staff;
    private final KnownUserStore users;
    private final CatalogSupport support;
    private final CatalogEvents events;
    private final FileStorage fileStorage;
    private final TransactionTemplate transactions;
    private final JdbcClient jdbc;
    private final Clock clock;
    private final String managerEmail;

    public DemoHotelSeeder(HotelRepository hotels, RoomTypeRepository roomTypes, RatePlanRepository ratePlans,
            SeasonalRateRepository seasonalRates, HotelImageRepository images, InventoryService inventory,
            LandmarkStore landmarks, HotelStaffStore staff, KnownUserStore users, CatalogSupport support,
            CatalogEvents events, FileStorage fileStorage, TransactionTemplate transactions, JdbcClient jdbc, Clock clock,
            @Value("${hotel.demo-data.manager-email:manager@flighthotel.local}") String managerEmail) {
        this.hotels = hotels;
        this.roomTypes = roomTypes;
        this.ratePlans = ratePlans;
        this.seasonalRates = seasonalRates;
        this.images = images;
        this.inventory = inventory;
        this.landmarks = landmarks;
        this.staff = staff;
        this.users = users;
        this.support = support;
        this.events = events;
        this.fileStorage = fileStorage;
        this.transactions = transactions;
        this.jdbc = jdbc;
        this.clock = clock;
        this.managerEmail = managerEmail;
    }

    @Override
    public void run(ApplicationArguments args) {
        long existing = jdbc.sql("SELECT COUNT(*) FROM hotels WHERE data_source = 'DEMO'").query(Long.class).single();
        if (existing > 0) {
            log.info("Demo hotels present ({}); seeding skipped", existing);
        } else {
            transactions.executeWithoutResult(status -> seed());
        }
        users.findByEmail(managerEmail).ifPresent(this::onUserKnown);
    }

    /** Called when identity-service announces an account: assigns the demo manager to the first demo hotels. */
    public void onUserKnown(KnownUser user) {
        if (!user.email().equalsIgnoreCase(managerEmail) || !user.hasRole(Roles.HOTEL_MANAGER)) {
            return;
        }
        List<UUID> demoHotels = jdbc.sql("SELECT id FROM hotels WHERE data_source = 'DEMO' ORDER BY name LIMIT "
                        + MANAGED_DEMO_HOTELS)
                .query((rs, i) -> com.flighthotel.hotel.support.Uuids.fromBytes(rs.getBytes("id"))).list();
        int assigned = 0;
        for (UUID hotelId : demoHotels) {
            if (staff.assign(hotelId, user.userId(), SecurityAuditorAware.SYSTEM, clock.instant())) {
                assigned++;
            }
        }
        if (assigned > 0) {
            log.info("Demo hotel manager {} assigned to {} demo hotels", user.email(), assigned);
        }
    }

    private void seed() {
        if (landmarks.count() == 0) {
            DemoData.LANDMARKS.forEach(l -> landmarks.add(l.city(), l.name(), l.type(), l.lat(), l.lon()));
        }
        for (DemoData.DemoHotel demo : DemoData.HOTELS) {
            Hotel hotel = new Hotel(demo.name(), support.uniqueSlug(demo.name(), demo.city()), demo.type(), demo.address(),
                    demo.city(), "IN", DataSource.DEMO);
            hotel.setState(demo.state());
            hotel.setStarRating(demo.stars());
            hotel.setDescription(demo.description() + DEMO_NOTE);
            hotel.setLatitude(BigDecimal.valueOf(demo.lat()));
            hotel.setLongitude(BigDecimal.valueOf(demo.lon()));
            hotel.setCheckInTime(LocalTime.of(14, 0));
            hotel.setCheckOutTime(LocalTime.of(11, 0));
            hotel.startWithRating(BigDecimal.valueOf(demo.rating()), demo.reviews());
            hotel.replaceAmenities(support.resolveAmenities(demo.amenities(), AmenityCategory.HOTEL));
            hotel.replacePolicies(List.of(
                    new HotelPolicy(PolicyType.ID_REQUIRED, "A government-issued photo ID is required at check-in for every adult."),
                    new HotelPolicy(PolicyType.CHILDREN, "Children of all ages are welcome. Children under 6 stay free using existing beds."),
                    new HotelPolicy(demo.amenities().contains("PET_FRIENDLY") ? PolicyType.PETS : PolicyType.SMOKING,
                            demo.amenities().contains("PET_FRIENDLY") ? "Pets are allowed on request (charges may apply)."
                                    : "Smoking is not allowed in rooms.")));
            hotel.changeStatus(HotelStatus.ACTIVE);
            hotel.setContactEmail("frontdesk@" + hotel.getSlug() + ".example");
            hotels.saveAndFlush(hotel);

            List<String> palette = DemoData.PALETTES.get(Math.floorMod(demo.name().hashCode(), DemoData.PALETTES.size()));
            addImage(hotel, demo.name(), "Exterior", palette, true, 0, null);
            addImage(hotel, demo.name(), "Lobby", palette, false, 1, null);

            int order = 0;
            for (DemoData.DemoRoom demoRoom : demo.rooms()) {
                RoomType room = new RoomType(hotel.getId());
                room.setName(demoRoom.name());
                room.setDescription(demoRoom.description());
                room.setMaxAdults(demoRoom.adults());
                room.setMaxChildren(demoRoom.children());
                room.setBedConfiguration(demoRoom.beds());
                room.setSizeSqm(demoRoom.sizeSqm());
                room.setTotalRooms(demoRoom.rooms());
                room.setSortOrder(order++);
                room.replaceAmenities(support.resolveAmenities(demoRoom.amenities(), AmenityCategory.ROOM));
                roomTypes.saveAndFlush(room);
                inventory.initialize(room.getId(), demoRoom.rooms());
                addImage(hotel, demo.name(), demoRoom.name(), palette, false, 10 + order, room.getId());
                addPlans(room, demoRoom.price(), demo.city());
            }
            events.catalogChanged(hotel.getId(), hotel.getStatus());
        }
        log.info("Demo data created: hotels={} landmarks={}", DemoData.HOTELS.size(), DemoData.LANDMARKS.size());
    }

    private void addPlans(RoomType room, int basePrice, String city) {
        RatePlan flexible = new RatePlan(room.getId());
        flexible.setName("Flexible with breakfast");
        flexible.setBasePricePerNight(BigDecimal.valueOf(basePrice + 900L));
        flexible.setBreakfastIncluded(true);
        flexible.setCancellation(true, 48, BigDecimal.valueOf(100));
        ratePlans.save(flexible);

        RatePlan saver = new RatePlan(room.getId());
        saver.setName("Saver (non-refundable)");
        saver.setBasePricePerNight(BigDecimal.valueOf(Math.round(basePrice * 0.88)));
        saver.setBreakfastIncluded(false);
        saver.setCancellation(false, null, null);
        ratePlans.save(saver);
        ratePlans.flush();

        // Peak season around the year end (beach destinations are busiest then).
        LocalDate today = inventory.today();
        LocalDate start = MonthDay.of(12, 20).atYear(today.getYear());
        if (start.plusDays(15).isBefore(today)) {
            start = start.plusYears(1);
        }
        BigDecimal factor = "Goa".equals(city) || "Udaipur".equals(city) ? BigDecimal.valueOf(1.4) : BigDecimal.valueOf(1.2);
        for (RatePlan plan : List.of(flexible, saver)) {
            seasonalRates.save(new SeasonalRate(plan.getId(), "Year-end peak", start, start.plusDays(15),
                    plan.getBasePricePerNight().multiply(factor).setScale(0, java.math.RoundingMode.HALF_UP)
                            .setScale(2),
                    10, clock.instant(), SecurityAuditorAware.SYSTEM));
        }
    }

    private void addImage(Hotel hotel, String hotelName, String caption, List<String> palette, boolean cover, int order,
            UUID roomTypeId) {
        BufferedImage picture = placeholder(hotelName, caption, palette);
        byte[] large = ImageProcessor.encodeJpeg(picture);
        byte[] thumb = ImageProcessor.encodeJpeg(ImageProcessor.resize(picture, 480));
        HotelImage image = new HotelImage(hotel.getId(), fileStorage.store("hotel-images", "jpg", large),
                fileStorage.store("hotel-images", "jpg", thumb), picture.getWidth(), picture.getHeight(), clock.instant(),
                SecurityAuditorAware.SYSTEM);
        image.setCaption(caption + " (demo image)");
        image.setCover(cover);
        image.setSortOrder(order);
        image.setRoomTypeId(roomTypeId);
        images.save(image);
    }

    /** A generated placeholder (gradient + name + "DEMO IMAGE"), never a photo pretending to be real. */
    static BufferedImage placeholder(String hotelName, String caption, List<String> palette) {
        int width = 1200;
        int height = 800;
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setPaint(new GradientPaint(0, 0, Color.decode(palette.get(0)), width, height, Color.decode(palette.get(1))));
            g.fillRect(0, 0, width, height);
            g.setColor(new Color(255, 255, 255, 40));
            for (int i = 0; i < 6; i++) {
                g.fillOval(-200 + i * 260, height - 260 + (i % 2) * 60, 420, 420);
            }
            g.setColor(Color.WHITE);
            g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 64));
            g.drawString(hotelName, 70, 360);
            g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 44));
            g.drawString(caption, 70, 430);
            g.setColor(new Color(0, 0, 0, 90));
            g.fillRoundRect(width - 330, 50, 270, 70, 20, 20);
            g.setColor(Color.WHITE);
            g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 34));
            g.drawString("DEMO IMAGE", width - 305, 98);
        } finally {
            g.dispose();
        }
        return image;
    }

}
