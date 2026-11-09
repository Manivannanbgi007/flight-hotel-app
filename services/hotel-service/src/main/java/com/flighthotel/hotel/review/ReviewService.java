package com.flighthotel.hotel.review;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.hotel.dto.ReviewDtos.CreateReviewRequest;
import com.flighthotel.hotel.dto.ReviewDtos.EligibleStay;
import com.flighthotel.hotel.dto.ReviewDtos.MyReview;
import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelReservation;
import com.flighthotel.hotel.entity.ReservationGuest;
import com.flighthotel.hotel.entity.ReservationStatus;
import com.flighthotel.hotel.entity.Review;
import com.flighthotel.hotel.entity.ReviewReport;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.HotelReservationRepository;
import com.flighthotel.hotel.repository.ReviewReportRepository;
import com.flighthotel.hotel.repository.ReviewRepository;
import com.flighthotel.hotel.staff.KnownUserStore;
import com.flighthotel.hotel.support.Paging;

/**
 * The customer's side of reviews (API_DOCUMENTATION.md §14.4): which stays can be reviewed, writing a review, my
 * reviews, and reporting someone else's review.
 * <p>
 * <b>Who may review what:</b> only the customer who booked the stay ({@code hotel_reservations.user_id}), only once
 * per booking, and only a completed stay: checked out by the hotel, or still CONFIRMED when the check-out date is
 * before today in the hotel's time zone (hotels that do not use the check-out button). Cancelled, no-show, held or
 * current stays cannot be reviewed. Someone else's booking gets the same answer as an unknown one
 * ({@code 422 NOT_ELIGIBLE}), so booking ids cannot be probed.
 */
@Service
@PreAuthorize("isAuthenticated()")
public class ReviewService {

    static final String NOT_ELIGIBLE = "NOT_ELIGIBLE";
    private static final Logger log = LoggerFactory.getLogger(ReviewService.class);
    private static final List<ReservationStatus> REVIEWABLE = List.of(ReservationStatus.CONFIRMED,
            ReservationStatus.CHECKED_OUT);

    private final HotelReservationRepository reservations;
    private final ReviewRepository reviews;
    private final ReviewReportRepository reports;
    private final HotelRepository hotels;
    private final KnownUserStore users;
    private final ReviewEvents events;
    private final ReviewSnapshots snapshots;
    private final Clock clock;

    public ReviewService(HotelReservationRepository reservations, ReviewRepository reviews,
            ReviewReportRepository reports, HotelRepository hotels, KnownUserStore users, ReviewEvents events,
            ReviewSnapshots snapshots, Clock clock) {
        this.reservations = reservations;
        this.reviews = reviews;
        this.reports = reports;
        this.hotels = hotels;
        this.users = users;
        this.events = events;
        this.snapshots = snapshots;
        this.clock = clock;
    }

    /** My completed stays without a review yet, most recent check-out first. */
    @Transactional(readOnly = true)
    public List<EligibleStay> eligible() {
        UUID userId = CurrentUser.require().id();
        List<HotelReservation> stays = reservations.findByUserIdAndStatusIn(userId, REVIEWABLE);
        if (stays.isEmpty()) {
            return List.of();
        }
        Set<UUID> reviewed = new HashSet<>(reviews.findReviewedBookingIds(userId,
                stays.stream().map(HotelReservation::getBookingId).toList()));
        Map<UUID, Hotel> hotelsById = hotels.findAllById(stays.stream().map(HotelReservation::getHotelId)
                .collect(Collectors.toSet())).stream().collect(Collectors.toMap(Hotel::getId, Function.identity()));
        Instant now = clock.instant();
        return stays.stream()
                .filter(stay -> !reviewed.contains(stay.getBookingId()))
                .filter(stay -> isCompleted(stay, hotelsById.get(stay.getHotelId()), now))
                .sorted(Comparator.comparing(HotelReservation::getCheckOut).reversed())
                .map(stay -> {
                    Hotel hotel = hotelsById.get(stay.getHotelId());
                    return new EligibleStay(stay.getBookingId(), stay.getBookingReference(), hotel.getId(),
                            hotel.getName(), hotel.getSlug(), stay.getCheckIn(), stay.getCheckOut());
                })
                .toList();
    }

    /** A new review, PENDING until a moderator approves it. */
    @Transactional
    public MyReview create(CreateReviewRequest request) {
        AuthenticatedUser user = CurrentUser.require();
        HotelReservation stay = reservations.findByBookingId(request.bookingId())
                .filter(reservation -> reservation.getUserId().equals(user.id()))
                .orElseThrow(() -> new BusinessRuleException(NOT_ELIGIBLE, "You can only review your own stays."));
        if (reviews.existsByBookingId(stay.getBookingId())) {
            throw alreadyReviewed();
        }
        Hotel hotel = hotels.findById(stay.getHotelId()).orElseThrow();
        if (!isCompleted(stay, hotel, clock.instant())) {
            throw new BusinessRuleException(NOT_ELIGIBLE, "You can review a stay once it is completed.");
        }
        Review review = Review.submit(stay, authorName(stay), request.rating(), request.title().strip(),
                request.text().strip());
        try {
            reviews.saveAndFlush(review);
        } catch (DataIntegrityViolationException ex) {
            // The same stay reviewed twice at the same moment (two tabs): the unique key decides.
            throw alreadyReviewed();
        }
        snapshots.changed(review.getId());
        events.changed(review);
        log.info("Review written reviewId={} hotelId={} bookingId={} rating={}", review.getId(), hotel.getId(),
                stay.getBookingId(), review.getRating());
        return ReviewViews.mine(review, hotel);
    }

    /** My reviews in any status, newest first, with the moderator's reason when rejected. */
    @Transactional(readOnly = true)
    public PageResponse<MyReview> mine(int page, int size) {
        UUID userId = CurrentUser.require().id();
        Page<Review> result = reviews.findByUserId(userId, Paging.of(page, size,
                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
        Map<UUID, Hotel> hotelsById = hotels.findAllById(result.getContent().stream().map(Review::getHotelId)
                .collect(Collectors.toSet())).stream().collect(Collectors.toMap(Hotel::getId, Function.identity()));
        return PageResponse.from(result, review -> ReviewViews.mine(review, hotelsById.get(review.getHotelId())));
    }

    /**
     * Flags a published review for the moderators. Once per user; never your own. Reviews that are not public (pending,
     * rejected) do not exist for others ({@code 404}).
     */
    @Transactional
    public void report(UUID reviewId, String reason) {
        UUID userId = CurrentUser.require().id();
        Review review = reviews.findById(reviewId).orElseThrow(() -> new ResourceNotFoundException("Review", reviewId));
        if (review.isWrittenBy(userId)) {
            throw new BusinessRuleException("OWN_REVIEW", "You cannot report your own review.");
        }
        if (!review.isApproved()) {
            throw new ResourceNotFoundException("Review", reviewId);
        }
        if (reports.existsByReviewIdAndReporterId(reviewId, userId)) {
            throw alreadyReported();
        }
        try {
            reports.saveAndFlush(new ReviewReport(reviewId, userId, reason.strip(), clock.instant()));
        } catch (DataIntegrityViolationException ex) {
            throw alreadyReported();
        }
        events.changed(review);
        log.info("Review reported reviewId={} hotelId={}", reviewId, review.getHotelId());
    }

    /**
     * Checked out, or confirmed and the check-out date is before today at the hotel. Today is taken in the hotel's
     * time zone, as everything else about a stay is.
     */
    static boolean isCompleted(HotelReservation stay, Hotel hotel, Instant now) {
        return switch (stay.getStatus()) {
            case CHECKED_OUT -> true;
            case CONFIRMED -> stay.getCheckOut().isBefore(LocalDate.ofInstant(now, ZoneId.of(hotel.getTimeZone())));
            default -> false;
        };
    }

    /** "First L." from the author's account (local copy of identity's users), else from the lead guest's name. */
    private String authorName(HotelReservation stay) {
        return users.findById(stay.getUserId())
                .map(user -> ReviewViews.authorName(user.firstName(), user.lastName()))
                .orElseGet(() -> {
                    ReservationGuest lead = stay.leadGuest().orElse(null);
                    return lead == null ? ReviewViews.authorName(null, null)
                            : ReviewViews.authorName(lead.getFirstName(), lead.getLastName());
                });
    }

    private static ConflictException alreadyReviewed() {
        return new ConflictException("ALREADY_REVIEWED", "You have already reviewed this stay.");
    }

    private static ConflictException alreadyReported() {
        return new ConflictException("ALREADY_REPORTED", "You have already reported this review.");
    }
}
