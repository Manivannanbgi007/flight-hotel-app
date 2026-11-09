package com.flighthotel.booking.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.dto.AdminDtos.AdminBookingRow;
import com.flighthotel.booking.dto.AdminDtos.GoodwillRefundRequest;
import com.flighthotel.booking.dto.BookingDtos.AttentionView;
import com.flighthotel.booking.dto.BookingDtos.RefundItem;
import com.flighthotel.booking.dto.BookingDtos.SupportBookingRow;
import com.flighthotel.booking.entity.Booking;
import com.flighthotel.booking.entity.BookingStatus;
import com.flighthotel.booking.entity.BookingType;
import com.flighthotel.booking.entity.RefundRequest;
import com.flighthotel.booking.entity.SupportNote;
import com.flighthotel.booking.repository.BookingRepository;
import com.flighthotel.booking.repository.FlightBookingRepository;
import com.flighthotel.booking.repository.HotelBookingRepository;
import com.flighthotel.booking.repository.RefundRequestRepository;
import com.flighthotel.booking.repository.SupportNoteRepository;
import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.ApiException;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.security.Roles;
import com.flighthotel.common.web.PageResponse;

import jakarta.persistence.criteria.Predicate;

/**
 * The support agent's booking tools (API_DOCUMENTATION.md section 8.5): find a booking, put it in or take it out of the
 * "Needs attention" queue, and (refund managers) send a failed refund again. Every action is audited; notes stay
 * internal.
 * <p>
 * Admin portal (section 14.2): the same search with creation dates and sorting, and goodwill refunds (money given back
 * while the booking stands).
 */
@Service
public class SupportBookingService {

    private static final int MAX_PAGE_SIZE = 50;
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final Pattern REFERENCE = Pattern.compile("^(HT|FL)-[A-Z0-9]{8}$");

    private final BookingRepository bookings;
    private final HotelBookingRepository hotelBookings;
    private final FlightBookingRepository flightBookings;
    private final RefundRequestRepository refunds;
    private final SupportNoteRepository notes;
    private final BookingSaga saga;
    private final BookingLifecycle lifecycle;
    private final AuditPublisher audit;
    private final Clock clock;

    public SupportBookingService(BookingRepository bookings, HotelBookingRepository hotelBookings,
            FlightBookingRepository flightBookings, RefundRequestRepository refunds, SupportNoteRepository notes,
            BookingSaga saga, BookingLifecycle lifecycle, AuditPublisher audit, Clock clock) {
        this.bookings = bookings;
        this.hotelBookings = hotelBookings;
        this.flightBookings = flightBookings;
        this.refunds = refunds;
        this.notes = notes;
        this.saga = saga;
        this.lifecycle = lifecycle;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * {@code query}: a booking reference, contact e-mail, PNR or hotel confirmation number (exact, any case). Flagged
     * bookings ({@code attention}) oldest flag first, otherwise newest first.
     */
    @PreAuthorize("hasAuthority('BOOKING_READ_ANY')")
    @Transactional(readOnly = true)
    public PageResponse<SupportBookingRow> search(String query, BookingStatus status, BookingType type,
            boolean attention, int page, int size) {
        Specification<Booking> filter = matching(query, status, type, attention, null, null);
        Sort sort = attention ? Sort.by(Sort.Direction.ASC, "attentionSince")
                : Sort.by(Sort.Direction.DESC, "createdAt");
        PageRequest request = PageRequest.of(Math.max(page, 0), Math.clamp(size, 1, MAX_PAGE_SIZE), sort);
        return PageResponse.from(bookings.findAll(filter, request), this::row);
    }

    /**
     * The admin booking search: {@link #search} plus the creation day range (India days, both inclusive) and
     * {@code sort=createdAt|totalAmount|startDate[,asc|desc]} (newest first by default).
     */
    @PreAuthorize("hasAuthority('BOOKING_READ_ANY')")
    @Transactional(readOnly = true)
    public PageResponse<AdminBookingRow> adminSearch(String query, BookingStatus status, BookingType type,
            LocalDate from, LocalDate to, boolean attention, int page, int size, String sort) {
        if (from != null && to != null && to.isBefore(from)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_RANGE", "'to' must not be before 'from'.");
        }
        Instant start = from == null ? null : from.atStartOfDay(INDIA).toInstant();
        Instant end = to == null ? null : to.plusDays(1).atStartOfDay(INDIA).toInstant();
        PageRequest request = PageRequest.of(Math.max(page, 0), Math.clamp(size, 1, 100), sortOf(sort));
        return PageResponse.from(bookings.findAll(matching(query, status, type, attention, start, end), request),
                this::adminRow);
    }

    /**
     * Gives money back while the booking stands (a delay, a complaint): at most what is still refundable, i.e. what was
     * paid minus refunds done or on their way. The booking keeps its status; a later cancellation refunds only the rest.
     * Idempotent per booking and {@code Idempotency-Key}.
     */
    @PreAuthorize("hasAuthority('REFUND_MANAGE')")
    @Transactional
    public RefundItem goodwillRefund(UUID bookingId, GoodwillRefundRequest body, String idempotencyKey) {
        String key = IdempotencyKeys.require(idempotencyKey);
        Booking booking = lock(bookingId);
        BigDecimal amount = body.amount().setScale(2, RoundingMode.HALF_UP);
        String reason = body.reason().strip();
        String hash = IdempotencyKeys.fingerprint(amount.toPlainString() + "|" + reason);
        RefundRequest repeat = refunds.findByBookingIdAndIdempotencyKey(bookingId, key).orElse(null);
        if (repeat != null) {
            if (!hash.equals(repeat.getRequestHash())) {
                throw new BusinessRuleException("IDEMPOTENCY_KEY_REUSED",
                        "This Idempotency-Key was already used for a different refund.");
            }
            return BookingQueryService.refundItem(repeat);
        }
        if (booking.getPaidPaymentId() == null) {
            throw new ConflictException("NOT_REFUNDABLE", "Nothing was paid for this booking.");
        }
        if (booking.getStatus() == BookingStatus.CANCELLATION_PENDING) {
            throw new ConflictException("NOT_REFUNDABLE",
                    "A cancellation of this booking is in progress. Wait for its refund, then refund more if needed.");
        }
        BigDecimal refundable = booking.getTotalAmount().subtract(refunds.sumRefundingTheBooking(bookingId))
                .max(BigDecimal.ZERO);
        if (amount.compareTo(refundable) > 0) {
            throw new BusinessRuleException("REFUND_TOO_LARGE", "At most "
                    + Amounts.format(refundable, booking.getCurrency()) + " can still be refunded for this booking.",
                    Map.of("refundable", refundable));
        }
        AuthenticatedUser user = CurrentUser.require();
        Instant now = clock.instant();
        RefundRequest refund = saga.requestRefund(booking, RefundRequest.goodwill(bookingId,
                booking.getPaidPaymentId(), amount, booking.getCurrency(), reason, user.id().toString(), key, hash, now));
        lifecycle.note(booking, "Goodwill refund of " + Amounts.format(amount, booking.getCurrency()) + " started",
                null);
        notes.save(note(bookingId, "GOODWILL_REFUND", reason, now));
        // The reason is internal (it may describe the customer's complaint): not in the audit details.
        audit.record("BOOKING_GOODWILL_REFUND", "BOOKING", bookingId.toString(), Map.of(
                "bookingReference", booking.getBookingReference(),
                "refundRequestId", refund.getId().toString(),
                "amount", amount.toPlainString(),
                "refundableBefore", refundable.toPlainString()));
        return BookingQueryService.refundItem(refund);
    }

    @PreAuthorize("hasAuthority('BOOKING_MANAGE_ANY')")
    @Transactional
    public AttentionView escalate(UUID bookingId, String note) {
        Booking booking = lock(bookingId);
        Instant now = clock.instant();
        booking.needsAttention("ESCALATED", note.strip(), now);
        notes.save(note(bookingId, "ESCALATED", note.strip(), now));
        lifecycle.changed(booking);
        audit.record("BOOKING_ESCALATED", "BOOKING", bookingId.toString(),
                Map.of("bookingReference", booking.getBookingReference()));
        return new AttentionView(booking.getAttentionReason(), booking.getAttentionNote(), booking.getAttentionSince());
    }

    @PreAuthorize("hasAuthority('BOOKING_MANAGE_ANY')")
    @Transactional
    public void resolve(UUID bookingId, String note) {
        Booking booking = lock(bookingId);
        String previous = booking.getAttentionReason();
        if (previous == null) {
            throw new ConflictException("NOTHING_TO_RESOLVE", "This booking is not in the \"Needs attention\" queue.");
        }
        booking.attentionResolved();
        String text = note == null || note.isBlank() ? null : note.strip();
        notes.save(note(bookingId, "RESOLVED", text, clock.instant()));
        lifecycle.changed(booking);
        audit.record("BOOKING_ATTENTION_RESOLVED", "BOOKING", bookingId.toString(),
                Map.of("bookingReference", booking.getBookingReference(), "previousReason", previous));
    }

    /** The booking's latest refund failed: ask payment-service again with a new request for the same money. */
    @PreAuthorize("hasAuthority('REFUND_MANAGE')")
    @Transactional
    public RefundItem retryRefund(UUID bookingId) {
        Booking booking = lock(bookingId);
        RefundRequest failed = refunds.findFirstByBookingIdOrderByRequestedAtDesc(bookingId)
                .filter(refund -> RefundRequest.FAILED.equals(refund.getStatus()) && refund.refundsTheBooking())
                .orElse(null);
        if (failed == null || booking.getStatus() != BookingStatus.REFUND_PENDING) {
            throw new ConflictException("NO_FAILED_REFUND", "This booking has no failed refund to send again.");
        }
        RefundRequest retry = saga.requestRefund(booking, failed.getPaymentId(), failed.getCancellationId(),
                failed.getAmount(), failed.getReason());
        booking.attentionResolved("REFUND_FAILED", "REFUND_NO_ANSWER");
        lifecycle.note(booking, "Refund of " + Amounts.format(retry.getAmount(), retry.getCurrency())
                + " started again", null);
        notes.save(note(bookingId, "REFUND_RETRIED", null, clock.instant()));
        audit.record("BOOKING_REFUND_RETRIED", "BOOKING", bookingId.toString(), Map.of(
                "bookingReference", booking.getBookingReference(),
                "failedRefundRequestId", failed.getId().toString(),
                "refundRequestId", retry.getId().toString(),
                "amount", retry.getAmount().toPlainString()));
        return BookingQueryService.refundItem(retry);
    }

    // ------------------------------------------------------------------ helpers

    private Specification<Booking> matching(String query, BookingStatus status, BookingType type,
            boolean attention, Instant createdFrom, Instant createdBefore) {
        String text = query == null ? "" : query.strip();
        List<UUID> byNumber = new ArrayList<>();
        if (!text.isEmpty() && !text.contains("@")) {
            String upper = text.toUpperCase(Locale.ROOT);
            byNumber.addAll(flightBookings.findIdsByPnr(upper));
            byNumber.addAll(hotelBookings.findIdsByConfirmationNumber(upper));
        }
        return (root, criteria, cb) -> {
            List<Predicate> where = new ArrayList<>();
            if (text.contains("@")) {
                where.add(cb.equal(root.get("contactEmail"), text.toLowerCase(Locale.ROOT)));
            } else if (!text.isEmpty()) {
                String upper = text.toUpperCase(Locale.ROOT);
                Predicate reference = cb.equal(root.get("bookingReference"), upper);
                where.add(byNumber.isEmpty() || REFERENCE.matcher(upper).matches() ? reference
                        : cb.or(reference, root.get("id").in(byNumber)));
            }
            if (status != null) {
                where.add(cb.equal(root.get("status"), status));
            }
            if (type != null) {
                where.add(cb.equal(root.get("bookingType"), type));
            }
            if (attention) {
                where.add(cb.isNotNull(root.get("attentionReason")));
            }
            if (createdFrom != null) {
                where.add(cb.greaterThanOrEqualTo(root.get("createdAt"), createdFrom));
            }
            if (createdBefore != null) {
                where.add(cb.lessThan(root.get("createdAt"), createdBefore));
            }
            return cb.and(where.toArray(Predicate[]::new));
        };
    }

    private SupportBookingRow row(Booking booking) {
        return new SupportBookingRow(booking.getId(), booking.getBookingReference(), booking.getBookingType(),
                booking.getStatus(), booking.getPaymentStatus(), booking.getTitle(), booking.getDestination(),
                booking.getStartDate(), booking.getEndDate(), booking.getTotalAmount(), booking.getCurrency(),
                booking.getCreatedAt(), booking.getContactEmail(), saga.leadName(booking),
                booking.getAttentionReason(), booking.getAttentionSince(), "DEMO".equals(booking.getInventorySource()));
    }

    private AdminBookingRow adminRow(Booking booking) {
        return new AdminBookingRow(booking.getId(), booking.getBookingReference(), booking.getBookingType(),
                booking.getStatus(), booking.getPaymentStatus(), booking.getTitle(), booking.getDestination(),
                booking.getStartDate(), booking.getEndDate(), booking.getTotalAmount(), booking.getRefundedAmount(),
                booking.getCurrency(), booking.getCreatedAt(), booking.getUserId(), booking.getContactEmail(),
                saga.leadName(booking), booking.getAttentionReason(), booking.getAttentionSince(),
                "DEMO".equals(booking.getInventorySource()));
    }

    private static final Map<String, String> SORTABLE = Map.of("createdAt", "createdAt", "totalAmount", "totalAmount",
            "startDate", "startDate");

    /** {@code field[,asc|desc]}; ties newest first, so pages are stable. */
    static Sort sortOf(String sort) {
        if (sort == null || sort.isBlank()) {
            return Sort.by(Sort.Direction.DESC, "createdAt");
        }
        String[] parts = sort.split(",");
        String field = SORTABLE.get(parts[0].strip());
        Sort.Direction direction = parts.length > 1 ? Sort.Direction.fromOptionalString(parts[1].strip()).orElse(null)
                : Sort.Direction.ASC;
        if (field == null || direction == null || parts.length > 2) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SORT",
                    "sort must be createdAt, totalAmount or startDate, optionally followed by ,asc or ,desc.");
        }
        Sort primary = Sort.by(direction, field);
        return "createdAt".equals(field) ? primary.and(Sort.by(direction, "id"))
                : primary.and(Sort.by(Sort.Direction.DESC, "createdAt"));
    }

    private Booking lock(UUID bookingId) {
        return bookings.lockById(bookingId).orElseThrow(() -> new ResourceNotFoundException("Booking", bookingId));
    }

    private static SupportNote note(UUID bookingId, String action, String text, Instant now) {
        AuthenticatedUser user = CurrentUser.require();
        return new SupportNote(bookingId, action, text, user.id().toString(),
                user.hasRole(Roles.ADMIN) ? Roles.ADMIN : Roles.SUPPORT_AGENT, now);
    }
}
