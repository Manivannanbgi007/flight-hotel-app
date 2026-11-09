package com.flighthotel.booking.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.booking.dto.AdminDtos.CouponRequest;
import com.flighthotel.booking.dto.AdminDtos.CouponView;
import com.flighthotel.booking.dto.AdminDtos.OfferRequest;
import com.flighthotel.booking.dto.AdminDtos.OfferView;
import com.flighthotel.booking.dto.AdminDtos.PublicOfferView;
import com.flighthotel.booking.entity.Coupon;
import com.flighthotel.booking.entity.CouponUsage;
import com.flighthotel.booking.entity.Offer;
import com.flighthotel.booking.repository.CouponRepository;
import com.flighthotel.booking.repository.CouponUsageRepository;
import com.flighthotel.booking.repository.OfferRepository;
import com.flighthotel.common.audit.AuditPublisher;
import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.web.PageResponse;

/**
 * Coupons and offers in the admin portal (API_DOCUMENTATION.md section 14.2) and the public list of current offers.
 * <p>
 * Coupon rules the admin cannot break: the code never changes (customers and bookings refer to it), a percent is
 * 1-100, the end is after the start, and a usage limit is never below what is already used. Edits carry the
 * {@code version} the admin saw, so nobody overwrites someone else's change. Every change is audited.
 */
@Service
public class PromotionService {

    private static final BigDecimal HUNDRED = new BigDecimal("100");
    private static final int MAX_PAGE_SIZE = 100;

    private final CouponRepository coupons;
    private final CouponUsageRepository usages;
    private final OfferRepository offers;
    private final AuditPublisher audit;
    private final Clock clock;

    public PromotionService(CouponRepository coupons, CouponUsageRepository usages, OfferRepository offers,
            AuditPublisher audit, Clock clock) {
        this.coupons = coupons;
        this.usages = usages;
        this.offers = offers;
        this.audit = audit;
        this.clock = clock;
    }

    // ================================================================== coupons

    @PreAuthorize("hasAuthority('COUPON_MANAGE')")
    @Transactional(readOnly = true)
    public PageResponse<CouponView> coupons(String query, String status, int page, int size) {
        Page<Coupon> found = coupons.search(like(query), blankToNull(status), PageRequest.of(Math.max(page, 0),
                Math.clamp(size, 1, MAX_PAGE_SIZE), Sort.by(Sort.Direction.DESC, "createdAt")));
        Map<UUID, Map<String, Long>> counts = usageCounts(found.getContent().stream().map(Coupon::getId).toList());
        Instant now = clock.instant();
        return PageResponse.from(found, coupon -> view(coupon, counts.getOrDefault(coupon.getId(), Map.of()), now));
    }

    @PreAuthorize("hasAuthority('COUPON_MANAGE')")
    @Transactional(readOnly = true)
    public CouponView coupon(UUID id) {
        Coupon coupon = findCoupon(id);
        return view(coupon, usageCounts(List.of(id)).getOrDefault(id, Map.of()), clock.instant());
    }

    @PreAuthorize("hasAuthority('COUPON_MANAGE')")
    @Transactional
    public CouponView createCoupon(CouponRequest request) {
        if (request.code() == null || request.code().isBlank()) {
            throw invalid("code", "Please enter a code.");
        }
        String code = request.code().strip().toUpperCase(Locale.ROOT);
        if (coupons.existsByCode(code)) {
            throw new ConflictException("COUPON_CODE_TAKEN", "A coupon with the code " + code + " already exists.");
        }
        Coupon coupon = new Coupon(code);
        apply(coupon, request);
        coupons.saveAndFlush(coupon);
        audit.record("COUPON_CREATED", "COUPON", coupon.getId().toString(), couponDetails(coupon));
        return view(coupon, Map.of(), clock.instant());
    }

    @PreAuthorize("hasAuthority('COUPON_MANAGE')")
    @Transactional
    public CouponView updateCoupon(UUID id, CouponRequest request) {
        Coupon coupon = coupons.lockById(id).orElseThrow(() -> new ResourceNotFoundException("Coupon", id));
        checkVersion(request.version(), coupon.getVersion());
        if (request.code() != null && !request.code().strip().equalsIgnoreCase(coupon.getCode())) {
            throw new BusinessRuleException("COUPON_CODE_CANNOT_CHANGE",
                    "The code of a coupon cannot change. Create a new coupon instead.", Map.of("field", "code"));
        }
        if (request.usageLimit() != null && request.usageLimit() < coupon.getUsedCount()) {
            throw new BusinessRuleException("USAGE_LIMIT_TOO_LOW", "The coupon is already used "
                    + coupon.getUsedCount() + " times; the limit cannot be lower.", Map.of("field", "usageLimit"));
        }
        apply(coupon, request);
        coupons.saveAndFlush(coupon);
        audit.record("COUPON_UPDATED", "COUPON", id.toString(), couponDetails(coupon));
        return coupon(id);
    }

    @PreAuthorize("hasAuthority('COUPON_MANAGE')")
    @Transactional
    public CouponView couponStatus(UUID id, String status) {
        Coupon coupon = coupons.lockById(id).orElseThrow(() -> new ResourceNotFoundException("Coupon", id));
        String previous = coupon.getStatus();
        coupon.setStatus(status);
        coupons.saveAndFlush(coupon);
        audit.record("COUPON_STATUS_CHANGED", "COUPON", id.toString(), Map.of("code", coupon.getCode(),
                "from", previous, "to", status));
        return coupon(id);
    }

    private void apply(Coupon coupon, CouponRequest request) {
        if (Coupon.PERCENT.equals(request.discountType()) && request.discountValue().compareTo(HUNDRED) > 0) {
            throw invalid("discountValue", "A percent discount is at most 100.");
        }
        if (!request.validTo().isAfter(request.validFrom())) {
            throw invalid("validTo", "The end must be after the start.");
        }
        coupon.setTitle(request.title().strip());
        coupon.setDescription(blankToNull(request.description()));
        coupon.setDiscountType(request.discountType());
        coupon.setDiscountValue(request.discountValue());
        // A cap only makes sense for percentages; a fixed amount is its own cap.
        coupon.setMaxDiscount(Coupon.PERCENT.equals(request.discountType()) ? request.maxDiscount() : null);
        coupon.setMinBookingAmount(request.minBookingAmount() == null ? BigDecimal.ZERO : request.minBookingAmount());
        coupon.setAppliesTo(request.appliesTo() == null ? Coupon.ALL : request.appliesTo());
        coupon.setDestinationCity(blankToNull(request.destinationCity()));
        coupon.setValidFrom(request.validFrom());
        coupon.setValidTo(request.validTo());
        coupon.setUsageLimit(request.usageLimit());
        coupon.setPerCustomerLimit(request.perCustomerLimit() == null ? 1 : request.perCustomerLimit());
        if (request.status() != null) {
            coupon.setStatus(request.status());
        }
    }

    private Map<UUID, Map<String, Long>> usageCounts(List<UUID> ids) {
        Map<UUID, Map<String, Long>> counts = new HashMap<>();
        if (ids.isEmpty()) {
            return counts;
        }
        for (Object[] row : usages.countByStatus(ids)) {
            counts.computeIfAbsent((UUID) row[0], key -> new HashMap<>()).put((String) row[1], (Long) row[2]);
        }
        return counts;
    }

    private static CouponView view(Coupon c, Map<String, Long> counts, Instant now) {
        return new CouponView(c.getId(), c.getCode(), c.getTitle(), c.getDescription(), c.getDiscountType(),
                c.getDiscountValue(), c.getMaxDiscount(), c.getMinBookingAmount(), c.getAppliesTo(),
                c.getDestinationCity(), c.getValidFrom(), c.getValidTo(), c.getUsageLimit(), c.getPerCustomerLimit(),
                c.getUsedCount(), counts.getOrDefault(CouponUsage.RESERVED, 0L),
                counts.getOrDefault(CouponUsage.CONSUMED, 0L), c.getStatus(), !now.isBefore(c.getValidTo()),
                c.isDemo(), c.getVersion(), c.getCreatedAt(), c.getUpdatedAt());
    }

    private static Map<String, String> couponDetails(Coupon c) {
        Map<String, String> details = new LinkedHashMap<>();
        details.put("code", c.getCode());
        details.put("discountType", c.getDiscountType());
        details.put("discountValue", c.getDiscountValue().toPlainString());
        details.put("status", c.getStatus());
        details.put("validTo", c.getValidTo().toString());
        return details;
    }

    // ================================================================== offers

    /** Current offers for everyone: active, within their dates, and only while the coupon itself can be used. */
    @Transactional(readOnly = true)
    public List<PublicOfferView> liveOffers() {
        Instant now = clock.instant();
        List<Offer> live = offers.findLive(now);
        Map<UUID, Coupon> byId = couponsById(live);
        return live.stream().filter(offer -> {
            Coupon coupon = byId.get(offer.getCouponId());
            return coupon != null && coupon.isActive() && coupon.isValidAt(now) && !coupon.usageLimitReached();
        }).map(offer -> {
            Coupon coupon = byId.get(offer.getCouponId());
            return new PublicOfferView(offer.getId(), offer.getTitle(), offer.getDescription(), coupon.getCode(),
                    discountLabel(coupon), coupon.getMinBookingAmount(), offer.getAppliesTo(),
                    offer.getDestinationCity(), offer.getValidTo().isBefore(coupon.getValidTo()) ? offer.getValidTo()
                            : coupon.getValidTo(), offer.isSeasonal(), offer.getTheme(), offer.isDemo());
        }).toList();
    }

    @PreAuthorize("hasAuthority('COUPON_MANAGE')")
    @Transactional(readOnly = true)
    public PageResponse<OfferView> offers(String query, String status, int page, int size) {
        Page<Offer> found = offers.search(like(query), blankToNull(status), PageRequest.of(Math.max(page, 0),
                Math.clamp(size, 1, MAX_PAGE_SIZE), Sort.by(Sort.Direction.DESC, "createdAt")));
        Map<UUID, Coupon> byId = couponsById(found.getContent());
        Instant now = clock.instant();
        return PageResponse.from(found, offer -> view(offer, byId.get(offer.getCouponId()), now));
    }

    @PreAuthorize("hasAuthority('COUPON_MANAGE')")
    @Transactional
    public OfferView createOffer(OfferRequest request) {
        Offer offer = new Offer();
        Coupon coupon = apply(offer, request);
        offers.saveAndFlush(offer);
        audit.record("OFFER_CREATED", "OFFER", offer.getId().toString(), offerDetails(offer, coupon));
        return view(offer, coupon, clock.instant());
    }

    @PreAuthorize("hasAuthority('COUPON_MANAGE')")
    @Transactional
    public OfferView updateOffer(UUID id, OfferRequest request) {
        Offer offer = offers.findById(id).orElseThrow(() -> new ResourceNotFoundException("Offer", id));
        checkVersion(request.version(), offer.getVersion());
        Coupon coupon = apply(offer, request);
        offers.saveAndFlush(offer);
        audit.record("OFFER_UPDATED", "OFFER", id.toString(), offerDetails(offer, coupon));
        return view(offer, coupon, clock.instant());
    }

    @PreAuthorize("hasAuthority('COUPON_MANAGE')")
    @Transactional
    public OfferView offerStatus(UUID id, String status) {
        Offer offer = offers.findById(id).orElseThrow(() -> new ResourceNotFoundException("Offer", id));
        String previous = offer.getStatus();
        offer.setStatus(status);
        offers.saveAndFlush(offer);
        Coupon coupon = coupons.findById(offer.getCouponId()).orElse(null);
        audit.record("OFFER_STATUS_CHANGED", "OFFER", id.toString(), Map.of("title", offer.getTitle(),
                "from", previous, "to", status));
        return view(offer, coupon, clock.instant());
    }

    private Coupon apply(Offer offer, OfferRequest request) {
        Coupon coupon = coupons.findById(request.couponId())
                .orElseThrow(() -> invalid("couponId", "This coupon does not exist."));
        if (!request.validTo().isAfter(request.validFrom())) {
            throw invalid("validTo", "The end must be after the start.");
        }
        offer.setTitle(request.title().strip());
        offer.setDescription(blankToNull(request.description()));
        offer.setCouponId(coupon.getId());
        offer.setAppliesTo(request.appliesTo() == null ? coupon.getAppliesTo() : request.appliesTo());
        offer.setDestinationCity(request.destinationCity() == null ? coupon.getDestinationCity()
                : blankToNull(request.destinationCity()));
        offer.setValidFrom(request.validFrom());
        offer.setValidTo(request.validTo());
        offer.setSeasonal(Boolean.TRUE.equals(request.seasonal()));
        offer.setTheme(request.theme() == null ? "OCEAN" : request.theme());
        if (request.status() != null) {
            offer.setStatus(request.status());
        }
        return coupon;
    }

    private Map<UUID, Coupon> couponsById(List<Offer> list) {
        return coupons.findAllById(list.stream().map(Offer::getCouponId).distinct().toList()).stream()
                .collect(Collectors.toMap(Coupon::getId, Function.identity()));
    }

    private static OfferView view(Offer o, Coupon coupon, Instant now) {
        boolean live = o.isLiveAt(now) && coupon != null && coupon.isActive() && coupon.isValidAt(now)
                && !coupon.usageLimitReached();
        return new OfferView(o.getId(), o.getTitle(), o.getDescription(), o.getCouponId(),
                coupon == null ? null : coupon.getCode(), coupon == null ? null : coupon.getStatus(),
                coupon == null ? null : discountLabel(coupon), o.getAppliesTo(), o.getDestinationCity(),
                o.getValidFrom(), o.getValidTo(), o.isSeasonal(), o.getTheme(), o.getStatus(), live, o.isDemo(),
                o.getVersion(), o.getCreatedAt(), o.getUpdatedAt());
    }

    private static Map<String, String> offerDetails(Offer o, Coupon coupon) {
        Map<String, String> details = new LinkedHashMap<>();
        details.put("title", o.getTitle());
        details.put("couponCode", coupon.getCode());
        details.put("status", o.getStatus());
        details.put("validTo", o.getValidTo().toString());
        return details;
    }

    /** "10% off, up to ₹1,500" or "₹500 off". */
    static String discountLabel(Coupon coupon) {
        if (Coupon.PERCENT.equals(coupon.getDiscountType())) {
            String label = coupon.getDiscountValue().stripTrailingZeros().toPlainString() + "% off";
            return coupon.getMaxDiscount() == null ? label
                    : label + ", up to " + Amounts.format(coupon.getMaxDiscount(), "INR");
        }
        return Amounts.format(coupon.getDiscountValue(), "INR") + " off";
    }

    // ================================================================== helpers

    private static void checkVersion(Long expected, Long actual) {
        if (expected != null && !expected.equals(actual)) {
            throw new ConflictException("CONCURRENT_MODIFICATION",
                    "This record was changed by someone else. Reload and try again.");
        }
    }

    private Coupon findCoupon(UUID id) {
        return coupons.findById(id).orElseThrow(() -> new ResourceNotFoundException("Coupon", id));
    }

    private static BusinessRuleException invalid(String field, String message) {
        return new BusinessRuleException("INVALID_VALUE", message, Map.of("field", field));
    }

    private static String like(String query) {
        return query == null || query.isBlank() ? null : "%" + query.strip().toLowerCase(Locale.ROOT) + "%";
    }

    private static String blankToNull(String text) {
        return text == null || text.isBlank() ? null : text.strip();
    }
}
