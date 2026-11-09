package com.flighthotel.hotel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.events.audit.AuditEventRecorded;
import com.flighthotel.events.hotel.HotelCatalogChanged;
import com.flighthotel.events.hotel.HotelReviewSnapshot;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelReservation;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.HotelReservationRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;
import com.flighthotel.hotel.review.ReviewSnapshotBackfill;
import com.flighthotel.hotel.search.HotelDocument;
import com.flighthotel.hotel.search.HotelIndexer;
import com.flighthotel.hotel.staff.HotelStaffStore;
import com.flighthotel.hotel.staff.KnownUserStore;
import com.flighthotel.hotel.staff.KnownUserStore.KnownUser;
import com.flighthotel.hotel.support.Uuids;
import com.jayway.jsonpath.JsonPath;

import co.elastic.clients.elasticsearch.ElasticsearchClient;

/**
 * Phase 9 reviews (API_DOCUMENTATION.md §14.4): who may review which stay, moderation and the hotel rating it
 * drives (database and search index), reports, the public lists and the managers' read-only view; and the review
 * snapshots on {@code hotel.events} for search-service (written, moderated, backfilled).
 */
class HotelReviewIntegrationTest extends HotelIntegrationTest {

    private static final String TEXT = "Lovely stay, friendly staff and a very quiet room facing the garden.";

    @Autowired
    TransactionTemplate transactions;

    @Autowired
    HotelRepository hotels;

    @Autowired
    RoomTypeRepository roomTypes;

    @Autowired
    RatePlanRepository ratePlans;

    @Autowired
    HotelReservationRepository reservations;

    @Autowired
    KnownUserStore users;

    @Autowired
    HotelStaffStore staff;

    @Autowired
    ElasticsearchClient elasticsearch;

    @Autowired
    ReviewSnapshotBackfill backfill;

    private TestStays stays;
    private Hotel hotel;
    private TestStays.Room room;
    private LocalDate today;

    @BeforeEach
    void testHotel() {
        stays = new TestStays(transactions, hotels, roomTypes, ratePlans, reservations, inventory, jdbcClient);
        // Started with "4.0 from 2 reviews", like a demo hotel with seeded figures.
        hotel = stays.hotel("Review Test Hotel", "Reviewville", HotelStatus.ACTIVE, new BigDecimal("4.0"), 2);
        today = inventory.today();
        room = stays.room(hotel.getId(), 6, "3000.00", today.minusDays(40), today.plusDays(30));
    }

    // ------------------------------------------------------------------ eligibility

    @Test
    void onlyTheGuestsOwnCompletedStaysCanBeReviewedOnce() throws Exception {
        UUID guest = knownCustomer("Asha", "Rao");
        HotelReservation checkedOut = stays.stay(room, guest, today.minusDays(10), today.minusDays(8),
                ReservationStatus.CHECKED_OUT);
        HotelReservation pastConfirmed = stays.stay(room, guest, today.minusDays(5), today.minusDays(3),
                ReservationStatus.CONFIRMED);
        HotelReservation inHouse = stays.stay(room, guest, today.minusDays(1), today.plusDays(1),
                ReservationStatus.CHECKED_IN);
        HotelReservation upcoming = stays.stay(room, guest, today.plusDays(5), today.plusDays(7),
                ReservationStatus.CONFIRMED);
        HotelReservation endsToday = stays.stay(room, guest, today.minusDays(2), today, ReservationStatus.CONFIRMED);
        HotelReservation cancelled = stays.stay(room, guest, today.minusDays(20), today.minusDays(18),
                ReservationStatus.CANCELLED);
        HotelReservation noShow = stays.stay(room, guest, today.minusDays(15), today.minusDays(14),
                ReservationStatus.NO_SHOW);
        HotelReservation someoneElses = stays.stay(room, UUID.randomUUID(), today.minusDays(10), today.minusDays(9),
                ReservationStatus.CHECKED_OUT);

        mockMvc.perform(get("/api/reviews/eligible").with(customer(guest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].bookingId").value(contains(pastConfirmed.getBookingId().toString(),
                        checkedOut.getBookingId().toString())))
                .andExpect(jsonPath("$[0].hotelName").value(hotel.getName()))
                .andExpect(jsonPath("$[0].hotelSlug").value(hotel.getSlug()))
                .andExpect(jsonPath("$[0].checkOut").value(today.minusDays(3).toString()));

        // Not completed yet, not completed at all, or not mine: 422 NOT_ELIGIBLE (the same answer for any foreign id).
        for (HotelReservation notEligible : List.of(inHouse, upcoming, endsToday, cancelled, noShow, someoneElses)) {
            mockMvc.perform(post("/api/reviews").with(customer(guest)).contentType(MediaType.APPLICATION_JSON)
                            .content(reviewJson(notEligible.getBookingId(), 5)))
                    .andExpect(status().isUnprocessableContent())
                    .andExpect(jsonPath("$.code").value("NOT_ELIGIBLE"));
        }
        mockMvc.perform(post("/api/reviews").with(customer(guest)).contentType(MediaType.APPLICATION_JSON)
                        .content(reviewJson(UUID.randomUUID(), 5)))
                .andExpect(jsonPath("$.code").value("NOT_ELIGIBLE"));
        mockMvc.perform(post("/api/reviews").with(customer(guest)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bookingId\":\"" + checkedOut.getBookingId()
                                + "\",\"rating\":6,\"title\":\"Hi\",\"text\":\"Too short\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mockMvc.perform(post("/api/reviews").contentType(MediaType.APPLICATION_JSON)
                        .content(reviewJson(checkedOut.getBookingId(), 5)))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/reviews").with(customer(guest)).contentType(MediaType.APPLICATION_JSON)
                        .content(reviewJson(checkedOut.getBookingId(), 5)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.authorName").value("Asha R."))
                .andExpect(jsonPath("$.stayedIn").value(monthOf(today.minusDays(10))))
                .andExpect(jsonPath("$.hotelName").value(hotel.getName()))
                .andExpect(jsonPath("$.bookingReference").value(checkedOut.getBookingReference()));
        mockMvc.perform(post("/api/reviews").with(customer(guest)).contentType(MediaType.APPLICATION_JSON)
                        .content(reviewJson(checkedOut.getBookingId(), 4)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_REVIEWED"));

        mockMvc.perform(get("/api/reviews/eligible").with(customer(guest)))
                .andExpect(jsonPath("$[*].bookingId").value(contains(pastConfirmed.getBookingId().toString())));
        mockMvc.perform(get("/api/reviews/mine").with(customer(guest)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].status").value("PENDING"));
        // Pending reviews are not public, and not counted in the rating.
        mockMvc.perform(get("/api/hotels/" + hotel.getSlug() + "/reviews"))
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.summary.count").value(0))
                .andExpect(jsonPath("$.summary.average").doesNotExist());
    }

    @Test
    void withoutAKnownAccountTheLeadGuestNamesTheReview() throws Exception {
        UUID unknown = UUID.randomUUID();
        HotelReservation stay = stays.stay(room, unknown, today.minusDays(6), today.minusDays(4), 1, "6000.00",
                ReservationStatus.CHECKED_OUT, "Ravi", "kumar");

        mockMvc.perform(post("/api/reviews").with(customer(unknown)).contentType(MediaType.APPLICATION_JSON)
                        .content(reviewJson(stay.getBookingId(), 4)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorName").value("Ravi K."));
    }

    // ------------------------------------------------------------------ moderation and rating

    @Test
    void moderationKeepsTheHotelRatingAndTheSearchIndexUpToDate() throws Exception {
        UUID fiveStars = review(5);
        UUID oneStar = review(1);

        mockMvc.perform(get("/api/admin/reviews").with(customer(UUID.randomUUID())))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/admin/reviews/" + fiveStars + "/approve").with(admin()))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/admin/reviews").param("status", "PENDING").param("q", hotel.getName()).with(moderator()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].hotelName").value(hotel.getName()))
                .andExpect(jsonPath("$.content[0].reportCount").value(0));

        // Seed 4.0 × 2 + 5 → 13 / 3 = 4.3 from 3 reviews.
        mockMvc.perform(post("/api/admin/reviews/" + fiveStars + "/approve").with(moderator()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.moderatedAt").exists());
        assertRating("4.3", 3);

        // + 1 → 14 / 4 = 3.5 from 4.
        mockMvc.perform(post("/api/admin/reviews/" + oneStar + "/approve").with(moderator()))
                .andExpect(status().isOk());
        assertRating("3.5", 4);

        // Taking the approved one down again: back to 4.3 from 3. A reason is required; rejecting twice is refused.
        mockMvc.perform(post("/api/admin/reviews/" + oneStar + "/reject").with(moderator())
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/admin/reviews/" + oneStar + "/reject").with(moderator())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Contains personal details\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.rejectionReason").value("Contains personal details"));
        assertRating("4.3", 3);
        mockMvc.perform(post("/api/admin/reviews/" + oneStar + "/reject").with(moderator())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Contains personal details\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_REVIEW_STATE"));

        // The author sees why; the public sees only the approved review.
        UUID oneStarAuthor = jdbcClient.sql("SELECT user_id FROM reviews WHERE id = :id")
                .param("id", Uuids.param(oneStar)).query((rs, i) -> Uuids.fromBytes(rs.getBytes(1))).single();
        mockMvc.perform(get("/api/reviews/mine").with(customer(oneStarAuthor)))
                .andExpect(jsonPath("$.content[0].status").value("REJECTED"))
                .andExpect(jsonPath("$.content[0].rejectionReason").value("Contains personal details"));
        mockMvc.perform(get("/api/hotels/" + hotel.getId() + "/reviews"))
                .andExpect(jsonPath("$.content[*].id").value(contains(fiveStars.toString())))
                .andExpect(jsonPath("$.summary.average").value(5.0))
                .andExpect(jsonPath("$.summary.distribution['1']").value(0));

        // Audited without the review's text or the moderator's reason.
        List<AuditEventRecorded> approved = stays.auditEvents(oneStar);
        assertThat(approved).extracting(AuditEventRecorded::getAction)
                .containsExactly("REVIEW_APPROVED", "REVIEW_REJECTED");
        assertThat(approved.getLast().getDetails()).containsEntry("previousStatus", "APPROVED")
                .containsEntry("hotelId", hotel.getId().toString())
                .doesNotContainKeys("text", "title", "reason");
        assertThat(approved.getLast().getDetails().values()).noneMatch(value -> value.contains("personal")
                || value.contains("Lovely"));
        // The rating change also reaches the search indexer (and other consumers) through the outbox.
        assertThat(stays.hotelEvents(hotel.getId())).hasAtLeastOneElementOfType(HotelCatalogChanged.class);
    }

    @Test
    void reportsPutAPublishedReviewInTheModerationQueue() throws Exception {
        UUID published = review(5);
        UUID pending = review(4);
        mockMvc.perform(post("/api/admin/reviews/" + published + "/approve").with(moderator()))
                .andExpect(status().isOk());
        UUID author = jdbcClient.sql("SELECT user_id FROM reviews WHERE id = :id")
                .param("id", Uuids.param(published)).query((rs, i) -> Uuids.fromBytes(rs.getBytes(1))).single();
        UUID reader = UUID.randomUUID();

        mockMvc.perform(post("/api/reviews/" + published + "/report").with(customer(author))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Testing my own\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("OWN_REVIEW"));
        mockMvc.perform(post("/api/reviews/" + published + "/report").with(customer(reader))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"No\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/reviews/" + published + "/report").with(customer(reader))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Advertising another hotel\"}"))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/api/reviews/" + published + "/report").with(customer(reader))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Advertising another hotel\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_REPORTED"));
        mockMvc.perform(post("/api/reviews/" + published + "/report").with(manager(UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Rude language\"}"))
                .andExpect(status().isNoContent());
        // A review that is not public does not exist for others.
        mockMvc.perform(post("/api/reviews/" + pending + "/report").with(customer(reader))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Advertising another hotel\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REVIEW_NOT_FOUND"));

        mockMvc.perform(get("/api/admin/reviews").param("reported", "true").param("q", hotel.getName()).with(moderator()))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(published.toString()))
                .andExpect(jsonPath("$.content[0].reportCount").value(2))
                .andExpect(jsonPath("$.content[0].reports[0].reason").value("Advertising another hotel"))
                .andExpect(jsonPath("$.content[0].reports[1].reason").value("Rude language"));

        // Keeping it (approve again) closes the reports; the rating is not touched.
        mockMvc.perform(post("/api/admin/reviews/" + published + "/approve").with(moderator()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.reportCount").value(0));
        mockMvc.perform(get("/api/admin/reviews").param("reported", "true").param("q", hotel.getName()).with(moderator()))
                .andExpect(jsonPath("$.totalElements").value(0));
        assertThat(stays.auditEvents(published).getLast().getDetails()).containsEntry("reportsClosed", "2");
        assertRating("4.3", 3);
    }

    // ------------------------------------------------------------------ public lists

    @Test
    void thePublicSeesOnlyApprovedReviewsWithTheirSummary() throws Exception {
        UUID five = review(5);
        UUID four = review(4);
        UUID two = review(2);
        UUID pending = review(5);
        for (UUID id : List.of(five, four, two)) {
            mockMvc.perform(post("/api/admin/reviews/" + id + "/approve").with(moderator())).andExpect(status().isOk());
        }

        mockMvc.perform(get("/api/hotels/" + hotel.getSlug() + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.content[*].id", not(hasItem(pending.toString()))))
                .andExpect(jsonPath("$.content[0].authorName").exists())
                .andExpect(jsonPath("$.content[0].stayedIn").exists())
                .andExpect(jsonPath("$.content[0].bookingReference").doesNotExist())
                .andExpect(jsonPath("$.summary.count").value(3))
                .andExpect(jsonPath("$.summary.average").value(3.7))
                .andExpect(jsonPath("$.summary.distribution['5']").value(1))
                .andExpect(jsonPath("$.summary.distribution['4']").value(1))
                .andExpect(jsonPath("$.summary.distribution['3']").value(0))
                .andExpect(jsonPath("$.summary.distribution['2']").value(1));
        mockMvc.perform(get("/api/hotels/" + hotel.getSlug() + "/reviews?sort=HIGHEST"))
                .andExpect(jsonPath("$.content[*].rating").value(contains(5, 4, 2)));
        mockMvc.perform(get("/api/hotels/" + hotel.getSlug() + "/reviews?sort=LOWEST&size=2"))
                .andExpect(jsonPath("$.content[*].rating").value(contains(2, 4)))
                .andExpect(jsonPath("$.totalPages").value(2));
        mockMvc.perform(get("/api/hotels/no-such-hotel/reviews"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("HOTEL_NOT_FOUND"));

        // Home page: 4 and 5 stars only, with the hotel.
        mockMvc.perform(get("/api/reviews/featured?limit=20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.hotelId == '" + hotel.getId() + "')].id",
                        containsInAnyOrder(five.toString(), four.toString())))
                .andExpect(jsonPath("$[?(@.id == '" + five + "')].city").value(hasItem("Reviewville")))
                .andExpect(jsonPath("$[?(@.id == '" + five + "')].hotelSlug").value(hasItem(hotel.getSlug())));
    }

    @Test
    void managersReadTheirHotelsReviewsInAnyStatus() throws Exception {
        UUID approved = review(5);
        review(3);
        mockMvc.perform(post("/api/admin/reviews/" + approved + "/approve").with(moderator()))
                .andExpect(status().isOk());
        UUID managerId = UUID.randomUUID();
        staff.assign(hotel.getId(), managerId, "test", Instant.now());
        UUID otherHotel = stays.hotel("Other Review Hotel", "Reviewville").getId();

        mockMvc.perform(get("/api/hotel-manager/hotels/" + hotel.getId() + "/reviews").with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].bookingReference").exists());
        mockMvc.perform(get("/api/hotel-manager/hotels/" + hotel.getId() + "/reviews?status=PENDING")
                        .with(manager(managerId)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].rating").value(3));
        mockMvc.perform(get("/api/hotel-manager/hotels/" + otherHotel + "/reviews").with(manager(managerId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("HOTEL_NOT_ASSIGNED"));

        // Phase 12: filter by stars, sort, and the figures above the list (approved reviews only; pending counted apart).
        String reviews = "/api/hotel-manager/hotels/" + hotel.getId() + "/reviews";
        mockMvc.perform(get(reviews).param("rating", "5").with(manager(managerId)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].rating").value(5));
        mockMvc.perform(get(reviews).param("sort", "lowest").with(manager(managerId)))
                .andExpect(jsonPath("$.content[*].rating").value(contains(3, 5)));
        mockMvc.perform(get(reviews).param("sort", "highest").with(manager(managerId)))
                .andExpect(jsonPath("$.content[*].rating").value(contains(5, 3)));
        mockMvc.perform(get(reviews).param("rating", "6").with(manager(managerId)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_RATING"));
        mockMvc.perform(get(reviews).param("sort", "random").with(manager(managerId)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_SORT"));
        mockMvc.perform(get(reviews + "/summary").with(manager(managerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.average").value(5.0))
                .andExpect(jsonPath("$.fiveStar").value(1))
                .andExpect(jsonPath("$.positive").value(1))
                .andExpect(jsonPath("$.negative").value(0))
                .andExpect(jsonPath("$.pending").value(1))
                .andExpect(jsonPath("$.distribution['5']").value(1))
                .andExpect(jsonPath("$.distribution['3']").value(0))
                .andExpect(jsonPath("$.months.length()").value(12))
                .andExpect(jsonPath("$.months[11].reviews").value(1))
                .andExpect(jsonPath("$.months[0].reviews").value(0))
                .andExpect(jsonPath("$.months[0].average").doesNotExist());
        mockMvc.perform(get("/api/hotel-manager/hotels/" + otherHotel + "/reviews/summary").with(manager(managerId)))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/hotel-manager/hotels/" + hotel.getId() + "/reviews").with(customer(UUID.randomUUID())))
                .andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------ snapshots for search-service

    @Test
    void writingAndModeratingAReviewPublishesItsSnapshotWithTheHotel() throws Exception {
        UUID reviewId = review(4);

        HotelReviewSnapshot written = only(reviewSnapshots(reviewId));
        HotelReservation stay = reservations.findByBookingId(UUID.fromString(written.getBookingId())).orElseThrow();
        assertThat(written.getReviewId()).isEqualTo(reviewId.toString());
        assertThat(written.getHotelId()).isEqualTo(hotel.getId().toString());
        assertThat(written.getHotelName()).isEqualTo(hotel.getName());
        assertThat(written.getHotelCity()).isEqualTo("Reviewville");
        assertThat(written.getReservationId()).isEqualTo(stay.getId().toString());
        assertThat(written.getBookingReference()).isEqualTo(stay.getBookingReference());
        assertThat(written.getUserId()).isEqualTo(stay.getUserId().toString());
        assertThat(written.getAuthorName()).isEqualTo("Guest4 T.");
        assertThat(written.getStayedOn()).isEqualTo(today.minusDays(12));
        assertThat(written.getRating()).isEqualTo(4);
        assertThat(written.getTitle()).isEqualTo("Great little hotel");
        assertThat(written.getText()).isEqualTo(TEXT);
        assertThat(written.getStatus()).isEqualTo("PENDING");
        assertThat(written.getCreatedAt()).isNotNull();
        assertThat(written.getChangedAt()).isNotNull();

        mockMvc.perform(post("/api/admin/reviews/" + reviewId + "/approve").with(moderator()))
                .andExpect(status().isOk());
        List<HotelReviewSnapshot> snapshots = reviewSnapshots(reviewId);
        assertThat(snapshots).hasSize(2);
        assertThat(snapshots.getLast().getStatus()).isEqualTo("APPROVED");
        assertThat(snapshots.getLast().getHotelName()).isEqualTo(hotel.getName());
        assertThat(snapshots.getLast().getChangedAt()).isAfterOrEqualTo(written.getChangedAt());

        // A report does not change the review itself: no snapshot.
        mockMvc.perform(post("/api/reviews/" + reviewId + "/report").with(customer(UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Advertising another hotel\"}"))
                .andExpect(status().isNoContent());
        assertThat(reviewSnapshots(reviewId)).hasSize(2);

        mockMvc.perform(post("/api/admin/reviews/" + reviewId + "/reject").with(moderator())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Off topic\"}"))
                .andExpect(status().isOk());
        assertThat(reviewSnapshots(reviewId)).extracting(HotelReviewSnapshot::getStatus)
                .containsExactly("PENDING", "APPROVED", "REJECTED");

        // A refused decision publishes nothing.
        mockMvc.perform(post("/api/admin/reviews/" + reviewId + "/reject").with(moderator())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Off topic\"}"))
                .andExpect(status().isConflict());
        assertThat(reviewSnapshots(reviewId)).hasSize(3);
        // Keyed by review id on hotel.events; the reservation and catalogue events keep their own keys.
        assertThat(stays.hotelEvents(reviewId)).allMatch(HotelReviewSnapshot.class::isInstance);
    }

    @Test
    void theBackfillPublishesEveryReviewOnceAndOnlyOnce() throws Exception {
        UUID reviewId = review(5);
        // Already run once when the application started.
        assertThat(jdbcClient.sql("SELECT done_at IS NOT NULL FROM data_backfills WHERE name = 'review-snapshots'")
                .query(Boolean.class).single()).isTrue();
        long reviews = jdbcClient.sql("SELECT COUNT(*) FROM reviews").query(Long.class).single();
        jdbcClient.sql("UPDATE data_backfills SET done_at = NULL WHERE name = 'review-snapshots'").update();
        long before = reviewSnapshotRows();

        backfill.onStart();
        backfill.onStart();   // already done: nothing more

        assertThat(reviewSnapshotRows() - before).isEqualTo(reviews);
        List<HotelReviewSnapshot> snapshots = reviewSnapshots(reviewId);
        assertThat(snapshots).hasSize(2);   // its own when written + the backfill's
        assertThat(snapshots.getLast().getStatus()).isEqualTo("PENDING");
        assertThat(snapshots.getLast().getHotelName()).isEqualTo(hotel.getName());
        assertThat(snapshots.getLast().getHotelCity()).isEqualTo("Reviewville");
        assertThat(jdbcClient.sql("SELECT done_at IS NOT NULL FROM data_backfills WHERE name = 'review-snapshots'")
                .query(Boolean.class).single()).isTrue();
    }

    // ------------------------------------------------------------------ helpers

    /** A new guest with a checked-out stay writes a review (PENDING). */
    private UUID review(int rating) throws Exception {
        UUID guest = knownCustomer("Guest" + rating, "Tester");
        HotelReservation stay = stays.stay(room, guest, today.minusDays(12), today.minusDays(10),
                ReservationStatus.CHECKED_OUT);
        String body = mockMvc.perform(post("/api/reviews").with(customer(guest)).contentType(MediaType.APPLICATION_JSON)
                        .content(reviewJson(stay.getBookingId(), rating)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(JsonPath.read(body, "$.id"));
    }

    private void assertRating(String rating, int reviews) throws Exception {
        assertThat(jdbcClient.sql("SELECT avg_rating FROM hotels WHERE id = :id")
                .param("id", Uuids.param(hotel.getId())).query(BigDecimal.class).single())
                .isEqualByComparingTo(rating);
        mockMvc.perform(get("/api/hotels/" + hotel.getId()))
                .andExpect(jsonPath("$.guestRating").value(Double.parseDouble(rating)))
                .andExpect(jsonPath("$.reviewCount").value(reviews));
        HotelDocument document = elasticsearch.get(g -> g.index(HotelIndexer.INDEX).id(hotel.getId().toString()),
                HotelDocument.class).source();
        assertThat(document).isNotNull();
        assertThat(document.guestRating()).isEqualTo(Double.parseDouble(rating));
        assertThat(document.reviewCount()).isEqualTo(reviews);
    }

    private UUID knownCustomer(String firstName, String lastName) {
        UUID id = UUID.randomUUID();
        users.upsert(new KnownUser(id, "guest-" + id + "@example.com", firstName, lastName, Set.of("CUSTOMER"),
                "ACTIVE"), Instant.now());
        return id;
    }

    private static JwtRequestPostProcessor customer(UUID userId) {
        return user(userId, Set.of("CUSTOMER"), Set.of());
    }

    private static JwtRequestPostProcessor moderator() {
        return user(UUID.randomUUID(), Set.of("ADMIN"), Set.of("REVIEW_MODERATE", "HOTEL_MANAGE_ANY"));
    }

    private static String reviewJson(UUID bookingId, int rating) {
        return """
                {"bookingId":"%s","rating":%d,"title":"Great little hotel","text":"%s"}"""
                .formatted(bookingId, rating, TEXT);
    }

    /** The review's snapshots in the outbox (hotel.events, key = review id), oldest first. */
    private List<HotelReviewSnapshot> reviewSnapshots(UUID reviewId) {
        return stays.hotelEvents(reviewId).stream().filter(HotelReviewSnapshot.class::isInstance)
                .map(HotelReviewSnapshot.class::cast).toList();
    }

    private long reviewSnapshotRows() {
        return jdbcClient.sql("SELECT COUNT(*) FROM outbox_events WHERE event_type = :type")
                .param("type", HotelReviewSnapshot.class.getName()).query(Long.class).single();
    }

    private static HotelReviewSnapshot only(List<HotelReviewSnapshot> snapshots) {
        assertThat(snapshots).hasSize(1);
        return snapshots.getFirst();
    }

    private static String monthOf(LocalDate date) {
        return DateTimeFormatter.ofPattern("MMM yyyy", Locale.ENGLISH).format(date);
    }
}
