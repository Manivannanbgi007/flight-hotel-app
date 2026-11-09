package com.flighthotel.hotel.devseed;

import java.awt.Color;
import java.awt.Font;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.common.dev.DevIds;
import com.flighthotel.common.dev.DevScenario;
import com.flighthotel.common.dev.DevScenario.HotelDef;
import com.flighthotel.common.dev.DevScenario.Outcome;
import com.flighthotel.common.dev.DevScenario.Person;
import com.flighthotel.common.dev.DevScenario.RoomDef;
import com.flighthotel.common.dev.DevScenario.Stay;
import com.flighthotel.common.dev.DevSeed;
import com.flighthotel.common.image.ImageProcessor;
import com.flighthotel.common.persistence.SecurityAuditorAware;
import com.flighthotel.common.storage.FileStorage;
import com.flighthotel.hotel.inventory.InventoryService;
import com.flighthotel.hotel.messaging.CatalogEvents;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.repository.ReviewRepository;
import com.flighthotel.hotel.review.HotelRatings;
import com.flighthotel.hotel.review.ReviewSnapshots;
import com.flighthotel.hotel.staff.KnownUserStore;
import com.flighthotel.hotel.staff.KnownUserStore.KnownUser;

/**
 * <b>Development only</b> ({@code hotel.dev-seed.enabled=true}, environment variable {@code DEV_SEED_ENABLED};
 * refuses to run in the {@code prod} profile). Three hotels ({@code data_source = INTERNAL}) with rooms, rate plans,
 * a year of inventory, generated placeholder photos, manager assignments for the development managers, and the
 * reservations and reviews of {@link DevScenario} in every state. Ids are deterministic, so booking-service and the
 * others refer to the same hotels, rooms and reservations without calling this service.
 * <p>
 * Rows are inserted directly (no booking saga, no events about reservations); only the catalogue change is announced
 * so the search index picks the hotels up, and each new review's snapshot is published (the same one every review
 * change publishes). Everything is skipped when the deterministic id already exists.
 */
@Component
@Order(20)
@ConditionalOnProperty(prefix = "hotel.dev-seed", name = "enabled", havingValue = "true")
public class DevHotelSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevHotelSeeder.class);
    private static final String BY = SecurityAuditorAware.SYSTEM;
    private static final List<List<String>> PALETTES = List.of(List.of("#0e7490", "#1e40af"),
            List.of("#b45309", "#7c2d12"), List.of("#15803d", "#164e63"));

    record ReviewDef(String stay, int rating, String status, String title, String body, String rejection) {
    }

    static final List<ReviewDef> REVIEWS = List.of(
            new ReviewDef("h01", 5, "APPROVED", "Perfect family beach holiday",
                    "The sea view suite was spacious and spotless, the staff arranged a late check-out for us and "
                            + "our son loved the kids' club. Breakfast on the terrace was the highlight.", null),
            new ReviewDef("h13", 3, "APPROVED", "Decent stay, a bit noisy",
                    "Good location and friendly front desk, but the garden rooms are close to the bar and the music "
                            + "went on until late. Breakfast was fine.", null),
            new ReviewDef("h11", 4, "APPROVED", "Smooth business trip",
                    "Fast Wi-Fi, a proper desk and a quiet floor. Check-in took two minutes. The gym is small but "
                            + "well kept.", null),
            new ReviewDef("h14", 5, "APPROVED", "Best value in the city",
                    "Spotless room, comfortable bed and a great breakfast buffet. Walking distance to MG Road.", null),
            new ReviewDef("h15", 5, "APPROVED", "Like staying in a palace",
                    "The haveli is beautiful, the courtyard dinner was memorable and the staff remembered our names "
                            + "from the first morning.", null),
            new ReviewDef("h02", 4, "PENDING", "Comfortable and quiet",
                    "Asked for a quiet room and got one. The executive floor lounge is a nice touch. The air "
                            + "conditioning was a little loud at night.", null),
            new ReviewDef("h12", 1, "REJECTED", "Awful",
                    "Do not stay here, call me on 98xxxxxx12 and I will tell you what the manager did.",
                    "The review contains a phone number and no details about the stay."));

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final InventoryService inventory;
    private final CatalogEvents catalogEvents;
    private final HotelRatings ratings;
    private final ReviewRepository reviewRepository;
    private final ReviewSnapshots reviewSnapshots;
    private final KnownUserStore knownUsers;
    private final FileStorage fileStorage;
    private final Environment environment;
    private final Clock clock;

    public DevHotelSeeder(JdbcClient jdbc, TransactionTemplate transactions, InventoryService inventory,
            CatalogEvents catalogEvents, HotelRatings ratings, ReviewRepository reviewRepository,
            ReviewSnapshots reviewSnapshots, KnownUserStore knownUsers, FileStorage fileStorage,
            Environment environment, Clock clock) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.inventory = inventory;
        this.catalogEvents = catalogEvents;
        this.ratings = ratings;
        this.reviewRepository = reviewRepository;
        this.reviewSnapshots = reviewSnapshots;
        this.knownUsers = knownUsers;
        this.fileStorage = fileStorage;
        this.environment = environment;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!DevSeed.allowed(environment, log, "hotel-service")) {
            return;
        }
        Instant now = clock.instant();
        LocalDate today = inventory.today();
        for (Person person : DevScenario.PEOPLE) {
            transactions.executeWithoutResult(status -> knownUsers.upsert(new KnownUser(person.id(), person.email(),
                    person.firstName(), person.lastName(), Set.of(person.role()), "ACTIVE"), now));
        }
        for (HotelDef hotel : DevScenario.HOTELS) {
            transactions.executeWithoutResult(status -> seedHotel(hotel, now));
        }
        int stays = 0;
        for (Stay stay : DevScenario.STAYS) {
            Boolean created = transactions.execute(status -> seedReservation(stay, now, today));
            stays += Boolean.TRUE.equals(created) ? 1 : 0;
        }
        int reviews = 0;
        for (ReviewDef review : REVIEWS) {
            Boolean created = transactions.execute(status -> seedReview(review, now));
            reviews += Boolean.TRUE.equals(created) ? 1 : 0;
        }
        for (HotelDef hotel : DevScenario.HOTELS) {
            // Rating from the approved reviews, and the search document (through the outbox and right away).
            transactions.executeWithoutResult(status -> ratings.recalculate(hotel.id()));
        }
        log.info("Development hotel data ready: {} hotels, {} new reservations, {} new reviews",
                DevScenario.HOTELS.size(), stays, reviews);
    }

    // ------------------------------------------------------------------ catalogue

    private void seedHotel(HotelDef hotel, Instant now) {
        if (exists("hotels", hotel.id())) {
            return;
        }
        Instant created = now.minus(200, ChronoUnit.DAYS);
        jdbc.sql("""
                        INSERT INTO hotels (id, name, slug, description, property_type, star_rating, address_line, city,
                          state, country_code, postal_code, latitude, longitude, time_zone, check_in_time, check_out_time,
                          contact_email, contact_phone, avg_rating, review_count, seed_rating, seed_review_count, status,
                          data_source, created_at, updated_at, created_by, updated_by, version)
                        VALUES (:id, :name, :slug, :description, :type, :stars, :address, :city, :state, 'IN', :postal,
                          :lat, :lon, 'Asia/Kolkata', :checkIn, :checkOut, :email, :phone, NULL, 0, NULL, 0, :status,
                          'INTERNAL', :created, :created, :by, :by, 0)""")
                .param("id", DevIds.bytes(hotel.id())).param("name", hotel.name()).param("slug", hotel.slug())
                .param("description", hotel.description()).param("type", hotel.propertyType())
                .param("stars", hotel.stars()).param("address", hotel.address()).param("city", hotel.city())
                .param("state", hotel.state()).param("postal", hotel.postalCode())
                .param("lat", BigDecimal.valueOf(hotel.latitude())).param("lon", BigDecimal.valueOf(hotel.longitude()))
                .param("checkIn", java.sql.Time.valueOf(DevScenario.CHECK_IN))
                .param("checkOut", java.sql.Time.valueOf(DevScenario.CHECK_OUT))
                .param("email", "frontdesk@" + hotel.slug() + ".example")
                .param("phone", "+9183222" + DevIds.digits(hotel.key(), 5))
                .param("status", HotelStatus.ACTIVE.name()).param("created", Timestamp.from(created)).param("by", BY)
                .update();
        jdbc.sql("""
                        INSERT IGNORE INTO hotel_amenities (hotel_id, amenity_id)
                        SELECT :hotel, id FROM amenities WHERE category = 'HOTEL' AND code IN (:codes)""")
                .param("hotel", DevIds.bytes(hotel.id())).param("codes", hotel.amenities()).update();
        policy(hotel, 0, "ID_REQUIRED", "A government-issued photo ID is required at check-in for every adult.");
        policy(hotel, 1, "CHILDREN", "Children of all ages are welcome. Children under 6 stay free using existing beds.");
        policy(hotel, 2, "SMOKING", "Smoking is not allowed in rooms.");

        List<String> palette = PALETTES.get(Math.floorMod(hotel.key().hashCode(), PALETTES.size()));
        image(hotel, null, "Exterior", palette, true, 0, now);
        image(hotel, null, "Lobby", palette, false, 1, now);
        int order = 0;
        for (RoomDef room : hotel.rooms()) {
            room(hotel, room, order++, created);
            image(hotel, room, room.name(), palette, false, 10 + order, now);
        }
        catalogEvents.catalogChanged(hotel.id(), HotelStatus.ACTIVE);
        for (String managerKey : hotel.managerKeys()) {
            jdbc.sql("""
                            INSERT IGNORE INTO hotel_staff (hotel_id, user_id, staff_role, assigned_at, assigned_by)
                            VALUES (:hotel, :user, 'MANAGER', :now, :by)""")
                    .param("hotel", DevIds.bytes(hotel.id()))
                    .param("user", DevIds.bytes(DevScenario.person(managerKey).id()))
                    .param("now", Timestamp.from(created)).param("by", BY).update();
        }
        log.info("Development hotel created name={} rooms={}", hotel.name(), hotel.rooms().size());
    }

    private void policy(HotelDef hotel, int order, String type, String text) {
        jdbc.sql("""
                        INSERT IGNORE INTO hotel_policies (id, hotel_id, policy_type, description, sort_order)
                        VALUES (:id, :hotel, :type, :text, :order)""")
                .param("id", DevIds.bytes(DevIds.of("policy", hotel.key() + ":" + order)))
                .param("hotel", DevIds.bytes(hotel.id())).param("type", type).param("text", text)
                .param("order", order).update();
    }

    private void room(HotelDef hotel, RoomDef room, int order, Instant created) {
        jdbc.sql("""
                        INSERT INTO room_types (id, hotel_id, name, description, max_adults, max_children,
                          bed_configuration, size_sqm, total_rooms, status, sort_order, created_at, updated_at, created_by,
                          updated_by, version)
                        VALUES (:id, :hotel, :name, :description, :adults, :children, :beds, :size, :total, 'ACTIVE',
                          :order, :created, :created, :by, :by, 0)""")
                .param("id", DevIds.bytes(room.id())).param("hotel", DevIds.bytes(hotel.id()))
                .param("name", room.name()).param("description", room.description())
                .param("adults", room.maxAdults()).param("children", room.maxChildren()).param("beds", room.beds())
                .param("size", room.sizeSqm()).param("total", room.totalRooms()).param("order", order)
                .param("created", Timestamp.from(created)).param("by", BY).update();
        jdbc.sql("""
                        INSERT IGNORE INTO room_type_amenities (room_type_id, amenity_id)
                        SELECT :room, id FROM amenities WHERE category = 'ROOM' AND code IN (:codes)""")
                .param("room", DevIds.bytes(room.id())).param("codes", room.amenities()).update();
        for (boolean flexible : new boolean[] {true, false}) {
            jdbc.sql("""
                            INSERT INTO rate_plans (id, room_type_id, name, base_price_per_night, currency,
                              breakfast_included, refundable, free_cancellation_hours, cancellation_fee_percent, status,
                              created_at, updated_at, created_by, updated_by, version)
                            VALUES (:id, :room, :name, :price, 'INR', :breakfast, :refundable, :hours, :fee, 'ACTIVE',
                              :created, :created, :by, :by, 0)""")
                    .param("id", DevIds.bytes(room.planId(flexible))).param("room", DevIds.bytes(room.id()))
                    .param("name", room.planName(flexible)).param("price", BigDecimal.valueOf(room.price(flexible)))
                    .param("breakfast", flexible).param("refundable", flexible)
                    .param("hours", flexible ? DevScenario.FLEX_FREE_HOURS : null)
                    .param("fee", BigDecimal.valueOf(flexible ? DevScenario.FLEX_FEE_PERCENT : 100))
                    .param("created", Timestamp.from(created)).param("by", BY).update();
        }
        // A year of sellable nights (INSERT IGNORE: nights that exist are left alone).
        inventory.initialize(room.id(), room.totalRooms());
    }

    private void image(HotelDef hotel, RoomDef room, String caption, List<String> palette, boolean cover, int order,
            Instant now) {
        BufferedImage picture = placeholder(hotel.name(), caption, palette);
        byte[] large = ImageProcessor.encodeJpeg(picture);
        byte[] thumb = ImageProcessor.encodeJpeg(ImageProcessor.resize(picture, 480));
        jdbc.sql("""
                        INSERT IGNORE INTO hotel_images (id, hotel_id, room_type_id, storage_key, thumb_key, caption,
                          sort_order, is_cover, width, height, created_at, created_by)
                        VALUES (:id, :hotel, :room, :large, :thumb, :caption, :order, :cover, :w, :h, :now, :by)""")
                .param("id", DevIds.bytes(DevIds.of("image", hotel.key() + ":" + order)))
                .param("hotel", DevIds.bytes(hotel.id()))
                .param("room", room == null ? null : DevIds.bytes(room.id()))
                .param("large", fileStorage.store("hotel-images", "jpg", large))
                .param("thumb", fileStorage.store("hotel-images", "jpg", thumb))
                .param("caption", caption + " (development image)").param("order", order).param("cover", cover)
                .param("w", picture.getWidth()).param("h", picture.getHeight()).param("now", Timestamp.from(now))
                .param("by", BY).update();
    }

    /** A generated placeholder (gradient, hotel name, "DEV DATA"), never a photo pretending to be real. */
    static BufferedImage placeholder(String hotelName, String caption, List<String> palette) {
        int width = 1200;
        int height = 800;
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setPaint(new GradientPaint(0, 0, Color.decode(palette.get(0)), width, height, Color.decode(palette.get(1))));
            g.fillRect(0, 0, width, height);
            g.setColor(Color.WHITE);
            g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 64));
            g.drawString(hotelName, 70, 360);
            g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 44));
            g.drawString(caption, 70, 430);
            g.setColor(new Color(0, 0, 0, 90));
            g.fillRoundRect(width - 330, 50, 270, 70, 20, 20);
            g.setColor(Color.WHITE);
            g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 34));
            g.drawString("DEV DATA", width - 290, 98);
        } finally {
            g.dispose();
        }
        return image;
    }

    // ------------------------------------------------------------------ reservations

    private boolean seedReservation(Stay stay, Instant now, LocalDate today) {
        if (exists("hotel_reservations", stay.reservationId())) {
            return false;
        }
        Person guest = stay.person();
        Outcome outcome = stay.outcome();
        LocalDate checkIn = stay.checkIn(today);
        LocalDate checkOut = stay.checkOut(today);
        Instant booked = stay.bookedAt(now);
        Instant confirmed = outcome.paid() ? booked.plus(12, ChronoUnit.MINUTES) : null;
        var price = stay.price();
        String status = switch (outcome) {
            case AWAITING_PAYMENT, PAYMENT_FAILED -> "HELD";
            case CONFIRMED -> "CONFIRMED";
            case IN_HOUSE -> "CHECKED_IN";
            case COMPLETED -> "CHECKED_OUT";
            case NO_SHOW -> "NO_SHOW";
            case CANCELLED_REFUNDED, CANCELLED_PARTIAL, CANCELLED_BY_HOTEL -> "CANCELLED";
        };
        Instant cancelledAt = stay.cancelledAt(now, today);
        Instant checkedIn = outcome == Outcome.IN_HOUSE || outcome == Outcome.COMPLETED
                ? checkIn.atTime(14, 30).atZone(DevScenario.INDIA).toInstant() : null;
        Instant checkedOut = outcome == Outcome.COMPLETED
                ? checkOut.atTime(10, 30).atZone(DevScenario.INDIA).toInstant() : null;
        Instant noShow = outcome == Outcome.NO_SHOW ? checkIn.plusDays(1).atTime(2, 0).atZone(DevScenario.INDIA).toInstant()
                : null;
        boolean byHotel = outcome == Outcome.CANCELLED_BY_HOTEL;
        UUID cancellationId = outcome.cancelled() ? DevIds.of("cancellation", stay.key()) : null;
        jdbc.sql("""
                        INSERT INTO hotel_reservations (id, booking_id, booking_reference, user_id, hotel_id, room_type_id,
                          rate_plan_id, quote_id, check_in, check_out, rooms, adults, children, status, hold_expires_at,
                          confirmation_number, currency, subtotal, taxes, total_amount, contact_email, contact_phone,
                          special_requests, confirmed_at, checked_in_at, checked_out_at, no_show_at, cancellation_id,
                          cancellation_reference, cancelled_at, cancelled_by, cancellation_reason, created_at, updated_at,
                          created_by, updated_by, version)
                        VALUES (:id, :booking, :reference, :user, :hotel, :room, :plan, :quote, :checkIn, :checkOut, :rooms,
                          :adults, :children, :status, :holdUntil, :confirmation, 'INR', :subtotal, :taxes, :total, :email,
                          :phone, :requests, :confirmed, :checkedIn, :checkedOut, :noShow, :cancellationId,
                          :cancellationRef, :cancelledAt, :cancelledBy, :reason, :booked, :updated, :user_s, :user_s, 0)""")
                .param("id", DevIds.bytes(stay.reservationId())).param("booking", DevIds.bytes(stay.bookingId()))
                .param("reference", stay.reference()).param("user", DevIds.bytes(guest.id()))
                .param("hotel", DevIds.bytes(stay.hotelDef().id())).param("room", DevIds.bytes(stay.roomDef().id()))
                .param("plan", DevIds.bytes(stay.roomDef().planId(stay.flex())))
                .param("quote", DevIds.bytes(stay.quoteId())).param("checkIn", Date.valueOf(checkIn))
                .param("checkOut", Date.valueOf(checkOut)).param("rooms", stay.rooms()).param("adults", stay.adults())
                .param("children", stay.children()).param("status", status)
                .param("holdUntil", outcome.held() ? Timestamp.from(now.plus(DevScenario.PENDING_HOLD)) : null)
                .param("confirmation", outcome.paid() ? stay.confirmationNumber() : null)
                .param("subtotal", price.subtotal()).param("taxes", price.taxes()).param("total", price.total())
                .param("email", guest.email()).param("phone", guest.phone()).param("requests", stay.requests())
                .param("confirmed", ts(confirmed)).param("checkedIn", ts(checkedIn)).param("checkedOut", ts(checkedOut))
                .param("noShow", ts(noShow))
                .param("cancellationId", cancellationId == null ? null : DevIds.bytes(cancellationId))
                .param("cancellationRef", cancellationId == null ? null : DevIds.code("HX", stay.key(), 8))
                .param("cancelledAt", ts(cancelledAt))
                .param("cancelledBy", cancellationId == null ? null : byHotel ? "HOTEL" : "CUSTOMER")
                .param("reason", byHotel ? "Overbooking: we could not honour this reservation." : null)
                .param("booked", Timestamp.from(booked))
                .param("updated", Timestamp.from(latest(booked, confirmed, checkedIn, checkedOut, noShow, cancelledAt)))
                .param("user_s", guest.id().toString())
                .update();
        List<String[]> names = stay.guests();
        for (int i = 0; i < stay.rooms(); i++) {
            String[] name = names.get(Math.min(i, names.size() - 1));
            jdbc.sql("""
                            INSERT INTO hotel_reservation_guests (reservation_id, room_no, first_name, last_name)
                            VALUES (:id, :no, :first, :last)""")
                    .param("id", DevIds.bytes(stay.reservationId())).param("no", i + 1).param("first", name[0])
                    .param("last", name[1]).update();
        }
        // Rooms on sale: held and booked rooms of the nights from today on (past nights have no inventory row).
        LocalDate from = checkIn.isBefore(today) ? today : checkIn;
        String column = switch (outcome) {
            case AWAITING_PAYMENT, PAYMENT_FAILED -> "held_rooms";
            case CONFIRMED, IN_HOUSE -> "booked_rooms";
            default -> null;
        };
        if (column != null && from.isBefore(checkOut)) {
            jdbc.sql("UPDATE room_inventory SET " + column + " = " + column + " + :rooms WHERE room_type_id = :room "
                            + "AND stay_date >= :from AND stay_date < :to")
                    .param("rooms", stay.rooms()).param("room", DevIds.bytes(stay.roomDef().id()))
                    .param("from", Date.valueOf(from)).param("to", Date.valueOf(checkOut)).update();
        }
        return true;
    }

    private boolean seedReview(ReviewDef def, Instant now) {
        Stay stay = DevScenario.stay(def.stay());
        UUID id = DevIds.of("review", def.stay());
        if (exists("reviews", id)) {
            return false;
        }
        LocalDate today = inventory.today();
        Instant written = stay.checkOut(today).plusDays(1).atTime(10, 0).atZone(DevScenario.INDIA).toInstant();
        boolean moderated = !def.status().equals("PENDING");
        Person guest = stay.person();
        jdbc.sql("""
                        INSERT INTO reviews (id, hotel_id, reservation_id, booking_id, booking_reference, user_id,
                          author_name, stayed_on, rating, title, body, status, rejection_reason, moderated_at, moderated_by,
                          created_at, updated_at, created_by, updated_by, version)
                        VALUES (:id, :hotel, :reservation, :booking, :reference, :user, :author, :stayedOn, :rating, :title,
                          :body, :status, :rejection, :moderatedAt, :moderatedBy, :written, :updated, :by, :by, 0)""")
                .param("id", DevIds.bytes(id)).param("hotel", DevIds.bytes(stay.hotelDef().id()))
                .param("reservation", DevIds.bytes(stay.reservationId())).param("booking", DevIds.bytes(stay.bookingId()))
                .param("reference", stay.reference()).param("user", DevIds.bytes(guest.id()))
                .param("author", guest.firstName() + " " + guest.lastName().charAt(0) + ".")
                .param("stayedOn", Date.valueOf(stay.checkIn(today))).param("rating", def.rating())
                .param("title", def.title()).param("body", def.body()).param("status", def.status())
                .param("rejection", def.rejection())
                .param("moderatedAt", moderated ? Timestamp.from(written.plus(1, ChronoUnit.DAYS)) : null)
                .param("moderatedBy", moderated ? DevScenario.ADMIN.id().toString() : null)
                .param("written", Timestamp.from(written))
                .param("updated", Timestamp.from(moderated ? written.plus(1, ChronoUnit.DAYS) : written))
                .param("by", guest.id().toString()).update();
        if (def.stay().equals("h13")) {
            // A manager reported this approved review: it shows in the moderation queue.
            jdbc.sql("""
                            INSERT INTO review_reports (id, review_id, reporter_id, reason, status, created_at)
                            VALUES (:id, :review, :reporter, :reason, 'OPEN', :now)""")
                    .param("id", DevIds.bytes(DevIds.of("review-report", def.stay())))
                    .param("review", DevIds.bytes(id))
                    .param("reporter", DevIds.bytes(DevScenario.MANAGER1.id()))
                    .param("reason", "The review describes the hotel's noise level incorrectly: the bar closes at 10 pm.")
                    .param("now", Timestamp.from(now.minus(2, ChronoUnit.DAYS))).update();
        }
        reviewRepository.findById(id).ifPresent(reviewSnapshots::publish);
        return true;
    }

    // ------------------------------------------------------------------ helpers

    private boolean exists(String table, UUID id) {
        return jdbc.sql("SELECT COUNT(*) FROM " + table + " WHERE id = :id").param("id", DevIds.bytes(id))
                .query(Long.class).single() > 0;
    }

    private static Timestamp ts(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    private static Instant latest(Instant first, Instant... others) {
        Instant latest = first;
        for (Instant other : others) {
            if (other != null && other.isAfter(latest)) {
                latest = other;
            }
        }
        return latest;
    }
}
