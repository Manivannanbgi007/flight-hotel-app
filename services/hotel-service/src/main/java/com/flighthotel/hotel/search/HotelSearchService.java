package com.flighthotel.hotel.search;

import static java.time.temporal.ChronoUnit.DAYS;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Predicate;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.hotel.dto.PublicHotelDtos.Destination;
import com.flighthotel.hotel.dto.PublicHotelDtos.Facets;
import com.flighthotel.hotel.dto.PublicHotelDtos.HotelCard;
import com.flighthotel.hotel.dto.PublicHotelDtos.SearchCriteria;
import com.flighthotel.hotel.dto.PublicHotelDtos.SearchResponse;
import com.flighthotel.hotel.dto.PublicHotelDtos.SearchSort;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.entity.PropertyType;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.search.LandmarkStore.Landmark;
import com.flighthotel.hotel.search.OfferCalculator.PricedPlan;
import com.flighthotel.hotel.search.OfferCalculator.RoomOfferData;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.ElasticsearchException;
import co.elastic.clients.elasticsearch._types.FieldValue;
import co.elastic.clients.elasticsearch._types.query_dsl.BoolQuery;
import co.elastic.clients.elasticsearch._types.query_dsl.Operator;
import co.elastic.clients.elasticsearch.core.search.Hit;

/**
 * Hotel search (CQRS):
 * <ol>
 *   <li>Elasticsearch finds hotels matching the destination and every date-independent filter (stars, rating,
 *       amenities, property type, distance, capacity, has free cancellation / breakfast at all).</li>
 *   <li>MySQL decides availability and price for the actual stay (free rooms on every night, seasonal prices,
 *       taxes). Price and availability filters, sorting and paging are applied to that result.</li>
 * </ol>
 * At most {@value #MAX_CANDIDATES} candidates per search (far more than one destination has today).
 */
@Service
public class HotelSearchService {

    static final int MAX_CANDIDATES = 500;
    private static final Logger log = LoggerFactory.getLogger(HotelSearchService.class);

    private final ElasticsearchClient elasticsearch;
    private final OfferCalculator offers;
    private final LandmarkStore landmarks;
    private final StayValidator stayValidator;
    private final HotelRepository hotels;

    public HotelSearchService(ElasticsearchClient elasticsearch, OfferCalculator offers, LandmarkStore landmarks,
            StayValidator stayValidator, HotelRepository hotels) {
        this.hotels = hotels;
        this.elasticsearch = elasticsearch;
        this.offers = offers;
        this.landmarks = landmarks;
        this.stayValidator = stayValidator;
    }

    @Transactional(readOnly = true)
    public SearchResponse search(SearchCriteria criteria) {
        stayValidator.validate(criteria.stay());
        String destination = criteria.destination().trim();
        Optional<Landmark> centre = landmarks.cityCentre(destination);

        List<Hit<HotelDocument>> hits = findCandidates(criteria, destination, centre.orElse(null));
        Map<UUID, List<RoomOfferData>> offersByHotel = offers.offers(
                hits.stream().map(hit -> UUID.fromString(hit.id())).toList(), criteria.stay());

        // Build every card, then filter on the stay-dependent criteria.
        List<Candidate> candidates = new ArrayList<>();
        for (int rank = 0; rank < hits.size(); rank++) {
            HotelDocument doc = hits.get(rank).source();
            if (doc == null) {
                continue;
            }
            candidates.add(toCandidate(doc, rank, offersByHotel.getOrDefault(UUID.fromString(doc.id()), List.of()),
                    criteria, centre.orElse(null)));
        }
        List<Candidate> beforePrice = candidates.stream()
                .filter(c -> !criteria.availableOnly() || c.card().available())
                .toList();
        List<Candidate> filtered = beforePrice.stream().filter(priceFilter(criteria)).toList();

        List<Candidate> sorted = new ArrayList<>(filtered);
        sorted.sort(comparator(criteria.sort() == null ? SearchSort.RECOMMENDED : criteria.sort()));

        int size = criteria.size();
        int from = Math.min(criteria.page() * size, sorted.size());
        List<HotelCard> page = sorted.subList(from, Math.min(from + size, sorted.size())).stream()
                .map(Candidate::card).toList();
        int totalPages = (int) Math.ceil(sorted.size() / (double) size);
        if (hits.size() >= MAX_CANDIDATES) {
            log.warn("Hotel search hit the candidate limit: destination={} limit={}", destination, MAX_CANDIDATES);
        }

        Destination resolved = new Destination(destination, centre.map(Landmark::city).orElse(null),
                centre.map(Landmark::name).orElse(null), centre.map(Landmark::latitude).orElse(null),
                centre.map(Landmark::longitude).orElse(null));
        return new SearchResponse(page, criteria.page(), size, sorted.size(), totalPages,
                (int) DAYS.between(criteria.stay().checkIn(), criteria.stay().checkOut()), resolved,
                facets(beforePrice, filtered));
    }

    private List<Hit<HotelDocument>> findCandidates(SearchCriteria criteria, String destination, Landmark centre) {
        BoolQuery.Builder bool = new BoolQuery.Builder();
        if (hotels.existsByCityIgnoreCaseAndStatus(destination, HotelStatus.ACTIVE)) {
            // A known city: exactly that city. (Fuzzy matching would also find "Udaipur" for "Jaipur".)
            String city = destination.toLowerCase(java.util.Locale.ROOT);
            bool.filter(f -> f.term(t -> t.field("city.exact").value(city)));
        } else {
            // Free text (hotel name, area, typo): 1 edit for 4-7 letters, 2 from 8 letters ("Bengalru").
            bool.must(m -> m.multiMatch(mm -> mm.query(destination)
                    .fields("city^4", "name^2", "state^2", "address")
                    .fuzziness("AUTO:4,8")
                    .operator(Operator.And)));
        }
        if (criteria.stars() != null && !criteria.stars().isEmpty()) {
            List<FieldValue> stars = criteria.stars().stream().map(s -> FieldValue.of(s.longValue())).toList();
            bool.filter(f -> f.terms(t -> t.field("starRating").terms(v -> v.value(stars))));
        }
        if (criteria.propertyTypes() != null && !criteria.propertyTypes().isEmpty()) {
            List<FieldValue> types = criteria.propertyTypes().stream().map(p -> FieldValue.of(p.name())).toList();
            bool.filter(f -> f.terms(t -> t.field("propertyType").terms(v -> v.value(types))));
        }
        if (criteria.amenities() != null) {
            // Every chosen amenity must be present.
            criteria.amenities().forEach(code -> bool.filter(f -> f.term(t -> t.field("amenities").value(code))));
        }
        if (criteria.minGuestRating() != null) {
            double minRating = criteria.minGuestRating().doubleValue();
            bool.filter(f -> f.range(r -> r.number(n -> n.field("guestRating").gte(minRating))));
        }
        if (criteria.freeCancellation()) {
            bool.filter(f -> f.term(t -> t.field("freeCancellation").value(true)));
        }
        if (criteria.breakfastIncluded()) {
            bool.filter(f -> f.term(t -> t.field("breakfast").value(true)));
        }
        double guestsPerRoom = Math.ceil(criteria.stay().guests() / (double) criteria.stay().rooms());
        bool.filter(f -> f.range(r -> r.number(n -> n.field("maxGuestsPerRoom").gte(guestsPerRoom))));
        if (criteria.maxDistanceKm() != null && centre != null) {
            String distance = criteria.maxDistanceKm() + "km";
            bool.filter(f -> f.geoDistance(g -> g.field("location").distance(distance)
                    .location(l -> l.latlon(ll -> ll.lat(centre.latitude()).lon(centre.longitude())))));
        }
        BoolQuery query = bool.build();
        try {
            return elasticsearch.search(s -> s.index(HotelIndexer.INDEX).size(MAX_CANDIDATES)
                    .query(q -> q.bool(query)), HotelDocument.class).hits().hits();
        } catch (ElasticsearchException ex) {
            if (ex.status() == 404) {
                log.warn("Search index {} does not exist yet; returning no results", HotelIndexer.INDEX);
                return List.of();
            }
            throw ex;
        } catch (IOException ex) {
            throw new UncheckedIOException("Hotel search failed", ex);
        }
    }

    private Candidate toCandidate(HotelDocument doc, int rank, List<RoomOfferData> roomOffers, SearchCriteria criteria,
            Landmark centre) {
        // Plans the customer could book right now that also satisfy the plan-level filters.
        List<RoomPlan> bookable = new ArrayList<>();
        for (RoomOfferData offer : roomOffers) {
            if (!offer.available()) {
                continue;
            }
            for (PricedPlan plan : offer.plans()) {
                if (criteria.freeCancellation() && !plan.plan().hasFreeCancellation()) {
                    continue;
                }
                if (criteria.breakfastIncluded() && !plan.plan().isBreakfastIncluded()) {
                    continue;
                }
                bookable.add(new RoomPlan(offer, plan));
            }
        }
        RoomPlan cheapest = bookable.stream()
                .min(Comparator.comparing((RoomPlan rp) -> rp.plan().price().total())).orElse(null);
        long availableRooms = bookable.stream().map(rp -> rp.offer().roomType().getId()).distinct().count();
        Double distance = centre == null || doc.location() == null ? null
                : BigDecimal.valueOf(centre.distanceKmTo(doc.location().lat(), doc.location().lon()))
                        .setScale(1, RoundingMode.HALF_UP).doubleValue();

        HotelCard card = new HotelCard(
                UUID.fromString(doc.id()),
                doc.slug(),
                doc.name(),
                PropertyType.valueOf(doc.propertyType()),
                doc.starRating(),
                doc.guestRating() == null ? null : BigDecimal.valueOf(doc.guestRating()).setScale(1, RoundingMode.HALF_UP),
                doc.reviewCount(),
                doc.address(),
                doc.city(),
                doc.countryCode(),
                doc.location() == null ? null : doc.location().lat(),
                doc.location() == null ? null : doc.location().lon(),
                doc.coverImageId() == null ? null : ImageUrls.thumb(UUID.fromString(doc.coverImageId())),
                doc.amenities(),
                cheapest != null,
                (int) availableRooms,
                cheapest == null ? null : cheapest.offer().roomType().getName(),
                cheapest == null ? null : cheapest.plan().price().pricePerNight(),
                cheapest == null ? null : cheapest.plan().price().total(),
                cheapest == null ? "INR" : cheapest.plan().price().currency(),
                bookable.stream().anyMatch(rp -> rp.plan().plan().hasFreeCancellation()),
                bookable.stream().anyMatch(rp -> rp.plan().plan().isBreakfastIncluded()),
                distance,
                "DEMO".equals(doc.dataSource()));
        return new Candidate(card, rank);
    }

    private static Predicate<Candidate> priceFilter(SearchCriteria criteria) {
        return candidate -> {
            BigDecimal price = candidate.card().pricePerNight();
            if (price == null) {
                // Unavailable hotels have no price; they are only listed when availableOnly=false.
                return criteria.minPrice() == null && criteria.maxPrice() == null;
            }
            return (criteria.minPrice() == null || price.compareTo(criteria.minPrice()) >= 0)
                    && (criteria.maxPrice() == null || price.compareTo(criteria.maxPrice()) <= 0);
        };
    }

    /** Available hotels always come first; unknown values (no price, no rating) sort last. */
    private static Comparator<Candidate> comparator(SearchSort sort) {
        Comparator<Candidate> availableFirst = Comparator.comparing((Candidate c) -> !c.card().available());
        Comparator<Candidate> byPrice = Comparator.comparing((Candidate c) -> c.card().pricePerNight(),
                Comparator.nullsLast(Comparator.naturalOrder()));
        Comparator<Candidate> byRating = Comparator.comparing((Candidate c) -> c.card().guestRating(),
                Comparator.nullsLast(Comparator.reverseOrder()));
        Comparator<Candidate> byStars = Comparator.comparing((Candidate c) -> c.card().starRating(),
                Comparator.nullsLast(Comparator.reverseOrder()));
        Comparator<Candidate> byRank = Comparator.comparingInt(Candidate::rank);
        return switch (sort) {
            case PRICE_ASC -> availableFirst.thenComparing(byPrice).thenComparing(byRank);
            case PRICE_DESC -> availableFirst.thenComparing(Comparator.comparing((Candidate c) -> c.card().pricePerNight(),
                    Comparator.nullsLast(Comparator.reverseOrder()))).thenComparing(byRank);
            case RATING_DESC -> availableFirst.thenComparing(byRating).thenComparing(byPrice);
            case STARS_DESC -> availableFirst.thenComparing(byStars).thenComparing(byPrice);
            case DISTANCE_ASC -> availableFirst.thenComparing(Comparator.comparing((Candidate c) -> c.card().distanceKm(),
                    Comparator.nullsLast(Comparator.naturalOrder()))).thenComparing(byPrice);
            case RECOMMENDED -> availableFirst.thenComparing(byRank).thenComparing(byRating).thenComparing(byPrice);
        };
    }

    /** Price range from the results before the price filter (so the slider does not shrink); counts after it. */
    private static Facets facets(List<Candidate> beforePrice, List<Candidate> filtered) {
        BigDecimal min = beforePrice.stream().map(c -> c.card().pricePerNight()).filter(p -> p != null)
                .min(Comparator.naturalOrder()).orElse(null);
        BigDecimal max = beforePrice.stream().map(c -> c.card().pricePerNight()).filter(p -> p != null)
                .max(Comparator.naturalOrder()).orElse(null);
        Map<Integer, Long> stars = new TreeMap<>(Comparator.reverseOrder());
        Map<String, Long> types = new LinkedHashMap<>();
        for (Candidate candidate : filtered) {
            if (candidate.card().starRating() != null) {
                stars.merge(candidate.card().starRating(), 1L, Long::sum);
            }
            types.merge(candidate.card().propertyType().name(), 1L, Long::sum);
        }
        return new Facets(min, max, new HashMap<>(stars), types);
    }

    private record Candidate(HotelCard card, int rank) {
    }

    private record RoomPlan(RoomOfferData offer, PricedPlan plan) {
    }
}
