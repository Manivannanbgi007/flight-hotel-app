package com.flighthotel.payment.service;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.payment.entity.PayableBooking;
import com.flighthotel.payment.entity.PaymentStatus;
import com.flighthotel.payment.entity.PaymentTransaction;
import com.flighthotel.payment.repository.PayableBookingRepository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;

/**
 * The one place that turns payment list filters into database predicates: the admin payment list ({@link
 * AdminPaymentService}) and the customer's own Payment History ({@link PaymentQueryService}) share it, so their
 * filters, sorting and summary figures can never drift apart. {@code owner} (customer side) limits every query to that
 * user's payments, whatever the other filters match.
 */
@Component
class PaymentSearch {

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    private final PayableBookingRepository payables;
    private final EntityManager entityManager;

    PaymentSearch(PayableBookingRepository payables, EntityManager entityManager) {
        this.payables = payables;
        this.entityManager = entityManager;
    }

    /** The filters after validation. {@code byBooking} is the booking whose reference the query is, if any. */
    record Filter(String text, UUID byBooking, PaymentStatus status, String provider, String method,
            String bookingType, Instant[] range) {
    }

    /** Counts and money of a filtered set (see {@link AdminPaymentService.PaymentSummary}). */
    record Totals(long total, long successful, long failed, long pending, BigDecimal collected, BigDecimal refunded) {
    }

    Filter filter(String query, PaymentStatus status, String provider, String method, String bookingType,
            LocalDate from, LocalDate to) {
        String type = blankToNull(bookingType) == null ? null : bookingType.strip().toUpperCase(Locale.ROOT);
        if (type != null && !type.equals("HOTEL") && !type.equals("FLIGHT")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_FILTER", "bookingType must be HOTEL or FLIGHT.");
        }
        return new Filter(query == null ? "" : query.strip(), bookingIdOf(query), status,
                blankToNull(provider) == null ? null : provider.strip().toUpperCase(Locale.ROOT),
                blankToNull(method) == null ? null : method.strip().toLowerCase(Locale.ROOT), type, range(from, to));
    }

    Specification<PaymentTransaction> specification(Filter filter, UUID owner) {
        return (root, criteria, cb) -> cb.and(predicates(filter, owner, root, cb, criteria).toArray(Predicate[]::new));
    }

    /** One grouped query over the same rows as {@link #specification}. */
    Totals totals(Filter filter, UUID owner) {
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaQuery<Tuple> criteria = cb.createTupleQuery();
        Root<PaymentTransaction> root = criteria.from(PaymentTransaction.class);
        criteria.multiselect(root.get("status").alias("status"), cb.count(root).alias("n"),
                cb.sum(root.<BigDecimal>get("amount")).alias("amount"),
                cb.sum(root.<BigDecimal>get("refundedAmount")).alias("refunded"))
                .where(predicates(filter, owner, root, cb, criteria).toArray(Predicate[]::new))
                .groupBy(root.get("status"));
        long total = 0;
        long successful = 0;
        long failed = 0;
        long pending = 0;
        BigDecimal collected = BigDecimal.ZERO;
        BigDecimal refunded = BigDecimal.ZERO;
        for (Tuple row : entityManager.createQuery(criteria).getResultList()) {
            PaymentStatus rowStatus = row.get("status", PaymentStatus.class);
            long count = row.get("n", Long.class);
            total += count;
            if (rowStatus.isPaid()) {
                successful += count;
                collected = collected.add(orZero(row.get("amount", BigDecimal.class)));
            } else if (rowStatus == PaymentStatus.FAILED) {
                failed += count;
            } else if (rowStatus.isOpen()) {
                pending += count;
            }
            refunded = refunded.add(orZero(row.get("refunded", BigDecimal.class)));
        }
        return new Totals(total, successful, failed, pending, collected, refunded);
    }

    private List<Predicate> predicates(Filter filter, UUID owner, Root<PaymentTransaction> root, CriteriaBuilder cb,
            CriteriaQuery<?> criteria) {
        List<Predicate> where = new ArrayList<>();
        if (owner != null) {
            where.add(cb.equal(root.get("userId"), owner));
        }
        if (!filter.text().isEmpty()) {
            List<Predicate> any = new ArrayList<>();
            any.add(cb.equal(root.get("providerPaymentId"), filter.text()));
            any.add(cb.equal(root.get("providerOrderId"), filter.text()));
            uuid(filter.text()).ifPresent(id -> any.add(cb.equal(root.get("id"), id)));
            if (filter.byBooking() != null) {
                any.add(cb.equal(root.get("bookingId"), filter.byBooking()));
            }
            if (filter.text().contains("@")) {
                Subquery<UUID> byEmail = criteria.subquery(UUID.class);
                Root<PayableBooking> booking = byEmail.from(PayableBooking.class);
                byEmail.select(booking.get("bookingId")).where(cb.equal(cb.lower(booking.get("contactEmail")),
                        filter.text().toLowerCase(Locale.ROOT)));
                any.add(root.get("bookingId").in(byEmail));
            }
            where.add(cb.or(any.toArray(Predicate[]::new)));
        }
        if (filter.status() != null) {
            where.add(cb.equal(root.get("status"), filter.status()));
        }
        if (filter.provider() != null) {
            where.add(cb.equal(root.get("provider"), filter.provider()));
        }
        if (filter.method() != null) {
            where.add(cb.equal(cb.lower(root.get("method")), filter.method()));
        }
        if (filter.bookingType() != null) {
            Subquery<UUID> ofType = criteria.subquery(UUID.class);
            Root<PayableBooking> booking = ofType.from(PayableBooking.class);
            ofType.select(booking.get("bookingId")).where(cb.equal(booking.get("bookingType"), filter.bookingType()));
            where.add(root.get("bookingId").in(ofType));
        }
        addRange(where, cb, root.get("createdAt"), filter.range());
        return where;
    }

    UUID bookingIdOf(String query) {
        if (query == null || query.isBlank()) {
            return null;
        }
        return payables.findByBookingReference(query.strip().toUpperCase(Locale.ROOT))
                .map(PayableBooking::getBookingId).orElse(null);
    }

    static Optional<UUID> uuid(String text) {
        try {
            return Optional.of(UUID.fromString(text));
        } catch (IllegalArgumentException notAnId) {
            return Optional.empty();
        }
    }

    /** India days, both inclusive, as [from, before) instants; {@code 400 INVALID_RANGE} when reversed. */
    static Instant[] range(LocalDate from, LocalDate to) {
        if (from != null && to != null && to.isBefore(from)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_RANGE", "'to' must not be before 'from'.");
        }
        return new Instant[] { from == null ? null : from.atStartOfDay(INDIA).toInstant(),
                to == null ? null : to.plusDays(1).atStartOfDay(INDIA).toInstant() };
    }

    static void addRange(List<Predicate> where, CriteriaBuilder cb, Path<Instant> at, Instant[] range) {
        if (range[0] != null) {
            where.add(cb.greaterThanOrEqualTo(at, range[0]));
        }
        if (range[1] != null) {
            where.add(cb.lessThan(at, range[1]));
        }
    }

    /** {@code sort=createdAt|amount[,asc|desc]}; newest first by default. */
    static Sort sortOf(String sort, Map<String, String> fields) {
        if (sort == null || sort.isBlank()) {
            return Sort.by(Sort.Direction.DESC, "createdAt").and(Sort.by(Sort.Direction.DESC, "id"));
        }
        String[] parts = sort.split(",");
        String field = fields.get(parts[0].strip());
        Sort.Direction direction = parts.length > 1 ? Sort.Direction.fromOptionalString(parts[1].strip()).orElse(null)
                : Sort.Direction.ASC;
        if (field == null || direction == null || parts.length > 2) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SORT",
                    "sort must be one of " + fields.keySet() + ", optionally followed by ,asc or ,desc.");
        }
        return Sort.by(direction, field).and(Sort.by(Sort.Direction.DESC, "createdAt"));
    }

    private static String blankToNull(String text) {
        return text == null || text.isBlank() ? null : text;
    }

    private static BigDecimal orZero(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }
}
