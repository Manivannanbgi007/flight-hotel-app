package com.flighthotel.hotel.search;

import java.io.IOException;
import java.io.StringReader;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.hotel.entity.Hotel;
import com.flighthotel.hotel.entity.HotelImage;
import com.flighthotel.hotel.entity.HotelStatus;
import com.flighthotel.hotel.entity.RatePlan;
import com.flighthotel.hotel.entity.RoomType;
import com.flighthotel.hotel.entity.SalesStatus;
import com.flighthotel.hotel.repository.HotelImageRepository;
import com.flighthotel.hotel.repository.HotelRepository;
import com.flighthotel.hotel.repository.RatePlanRepository;
import com.flighthotel.hotel.repository.RoomTypeRepository;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.ElasticsearchException;
import co.elastic.clients.elasticsearch._types.Refresh;
import co.elastic.clients.elasticsearch.core.BulkRequest;
import co.elastic.clients.elasticsearch.core.BulkResponse;

/**
 * Builds the search documents from MySQL (the source of truth). Rebuilding a whole document from the database makes
 * every update idempotent: replaying an event or re-indexing everything always gives the same result.
 */
@Component
public class HotelIndexer {

    public static final String INDEX = "hotels";
    /** Bump when the mapping below changes: the index is then recreated and refilled on startup. */
    static final int MAPPING_VERSION = 1;
    private static final Logger log = LoggerFactory.getLogger(HotelIndexer.class);

    /** Explicit mapping: cities match case-insensitively, location is a geo point, codes are exact keywords. */
    private static final String INDEX_DEFINITION = """
            {
              "settings": {
                "number_of_shards": 1,
                "analysis": { "normalizer": { "lowercase": { "type": "custom", "filter": ["lowercase", "asciifolding"] } } }
              },
              "mappings": {
                "_meta": { "mappingVersion": 1 },
                "dynamic": "strict",
                "properties": {
                  "id":               { "type": "keyword" },
                  "slug":             { "type": "keyword" },
                  "name":             { "type": "text", "fields": { "exact": { "type": "keyword", "normalizer": "lowercase" } } },
                  "city":             { "type": "text", "fields": { "exact": { "type": "keyword", "normalizer": "lowercase" } } },
                  "state":            { "type": "text" },
                  "countryCode":      { "type": "keyword" },
                  "address":          { "type": "text" },
                  "location":         { "type": "geo_point" },
                  "starRating":       { "type": "integer" },
                  "guestRating":      { "type": "float" },
                  "reviewCount":      { "type": "integer" },
                  "propertyType":     { "type": "keyword" },
                  "amenities":        { "type": "keyword" },
                  "freeCancellation": { "type": "boolean" },
                  "breakfast":        { "type": "boolean" },
                  "maxGuestsPerRoom": { "type": "integer" },
                  "minBasePrice":     { "type": "double" },
                  "coverImageId":     { "type": "keyword", "index": false },
                  "dataSource":       { "type": "keyword" }
                }
              }
            }""";

    private final ElasticsearchClient elasticsearch;
    private final HotelRepository hotels;
    private final RoomTypeRepository roomTypes;
    private final RatePlanRepository ratePlans;
    private final HotelImageRepository images;
    private volatile boolean indexReady;

    public HotelIndexer(ElasticsearchClient elasticsearch, HotelRepository hotels, RoomTypeRepository roomTypes,
            RatePlanRepository ratePlans, HotelImageRepository images) {
        this.elasticsearch = elasticsearch;
        this.hotels = hotels;
        this.roomTypes = roomTypes;
        this.ratePlans = ratePlans;
        this.images = images;
    }

    /**
     * Makes sure the index exists WITH OUR MAPPING before anything is written. (Writing to a missing index would let
     * Elasticsearch create one with guessed field types, e.g. location without geo_point.) An index from an older
     * mapping version is replaced.
     *
     * @return true if the index was (re)created and must be filled
     */
    public synchronized boolean ensureIndex() {
        if (indexReady) {
            return false;
        }
        try {
            boolean created = false;
            if (elasticsearch.indices().exists(e -> e.index(INDEX)).value()) {
                if (mappingVersion() != MAPPING_VERSION) {
                    log.warn("Search index {} has mapping version {}, expected {}; recreating", INDEX, mappingVersion(),
                            MAPPING_VERSION);
                    elasticsearch.indices().delete(d -> d.index(INDEX));
                    created = create();
                }
            } else {
                created = create();
            }
            indexReady = true;
            return created;
        } catch (IOException ex) {
            throw new UncheckedIOException("Could not prepare search index", ex);
        }
    }

    private boolean create() throws IOException {
        try {
            elasticsearch.indices().create(c -> c.index(INDEX).withJson(new StringReader(INDEX_DEFINITION)));
            log.info("Created search index {} (mapping version {})", INDEX, MAPPING_VERSION);
            return true;
        } catch (ElasticsearchException ex) {
            // Another instance (or thread) created it at the same moment: fine.
            if ("resource_already_exists_exception".equals(ex.error().type())) {
                return false;
            }
            throw ex;
        }
    }

    private int mappingVersion() throws IOException {
        var mapping = elasticsearch.indices().getMapping(g -> g.index(INDEX)).get(INDEX);
        if (mapping == null || mapping.mappings().meta() == null || !mapping.mappings().meta().containsKey("mappingVersion")) {
            return -1;
        }
        return mapping.mappings().meta().get("mappingVersion").to(Integer.class);
    }

    /** Adds, updates or removes one hotel: only ACTIVE hotels are searchable. */
    @Transactional(readOnly = true)
    public void reindex(UUID hotelId) {
        ensureIndex();
        Optional<Hotel> hotel = hotels.findWithDetailsById(hotelId);
        try {
            if (hotel.isEmpty() || hotel.get().getStatus() != HotelStatus.ACTIVE) {
                delete(hotelId);
                return;
            }
            HotelDocument document = buildDocuments(List.of(hotel.get())).getFirst();
            elasticsearch.index(i -> i.index(INDEX).id(document.id()).document(document).refresh(Refresh.WaitFor));
        } catch (IOException ex) {
            throw new UncheckedIOException("Could not index hotel " + hotelId, ex);
        }
    }

    /**
     * Brings the whole index in line with MySQL (startup check, admin action): every ACTIVE hotel is (re)written and
     * documents of hotels that are no longer ACTIVE are removed. The index itself stays in place, so searches keep
     * working meanwhile.
     */
    @Transactional(readOnly = true)
    public int reindexAll() {
        ensureIndex();
        try {
            List<HotelDocument> documents = buildDocuments(hotels.findByStatus(HotelStatus.ACTIVE));
            for (int from = 0; from < documents.size(); from += 500) {
                List<HotelDocument> chunk = documents.subList(from, Math.min(from + 500, documents.size()));
                BulkRequest.Builder bulk = new BulkRequest.Builder().refresh(Refresh.True);
                chunk.forEach(doc -> bulk.operations(op -> op.index(idx -> idx.index(INDEX).id(doc.id()).document(doc))));
                BulkResponse response = elasticsearch.bulk(bulk.build());
                if (response.errors()) {
                    throw new IllegalStateException("Bulk indexing reported errors");
                }
            }
            Set<String> active = documents.stream().map(HotelDocument::id).collect(Collectors.toSet());
            List<String> stale = elasticsearch.search(s -> s.index(INDEX).size(10_000).source(src -> src.fetch(false)),
                            HotelDocument.class).hits().hits().stream().map(hit -> hit.id()).filter(id -> !active.contains(id)).toList();
            for (String id : stale) {
                delete(UUID.fromString(id));
            }
            log.info("Search index rebuilt: hotels={} removed={}", documents.size(), stale.size());
            return documents.size();
        } catch (IOException ex) {
            throw new UncheckedIOException("Could not rebuild search index", ex);
        }
    }

    public long documentCount() {
        try {
            ensureIndex();
            elasticsearch.indices().refresh(r -> r.index(INDEX));
            return elasticsearch.count(c -> c.index(INDEX)).count();
        } catch (IOException ex) {
            throw new UncheckedIOException("Could not count search documents", ex);
        }
    }

    private void delete(UUID hotelId) throws IOException {
        try {
            elasticsearch.delete(d -> d.index(INDEX).id(hotelId.toString()).refresh(Refresh.WaitFor));
        } catch (ElasticsearchException ex) {
            if (ex.status() != 404) {
                throw ex;
            }
        }
    }

    private List<HotelDocument> buildDocuments(List<Hotel> hotelList) {
        if (hotelList.isEmpty()) {
            return List.of();
        }
        List<UUID> hotelIds = hotelList.stream().map(Hotel::getId).toList();
        Map<UUID, List<RoomType>> rooms = roomTypes.findByHotelIdInAndStatus(hotelIds, SalesStatus.ACTIVE).stream()
                .collect(Collectors.groupingBy(RoomType::getHotelId));
        List<UUID> roomTypeIds = rooms.values().stream().flatMap(List::stream).map(RoomType::getId).toList();
        Map<UUID, List<RatePlan>> plans = roomTypeIds.isEmpty() ? Map.of()
                : ratePlans.findByRoomTypeIdInAndStatus(roomTypeIds, SalesStatus.ACTIVE).stream()
                        .collect(Collectors.groupingBy(RatePlan::getRoomTypeId));
        Map<UUID, UUID> covers = images.findByHotelIdInAndCoverTrue(hotelIds).stream()
                .collect(Collectors.toMap(HotelImage::getHotelId, HotelImage::getId, (a, b) -> a));

        List<HotelDocument> documents = new ArrayList<>(hotelList.size());
        for (Hotel hotel : hotelList) {
            // Only room types that can actually be sold (they have a plan on sale) count.
            List<RoomType> sellable = rooms.getOrDefault(hotel.getId(), List.of()).stream()
                    .filter(room -> !plans.getOrDefault(room.getId(), List.of()).isEmpty())
                    .toList();
            List<RatePlan> hotelPlans = sellable.stream()
                    .flatMap(room -> plans.getOrDefault(room.getId(), List.of()).stream()).toList();
            documents.add(new HotelDocument(
                    hotel.getId().toString(),
                    hotel.getSlug(),
                    hotel.getName(),
                    hotel.getCity(),
                    hotel.getState(),
                    hotel.getCountryCode(),
                    hotel.getAddressLine(),
                    hotel.getLatitude() == null || hotel.getLongitude() == null ? null
                            : new HotelDocument.GeoLocation(hotel.getLatitude().doubleValue(),
                                    hotel.getLongitude().doubleValue()),
                    hotel.getStarRating(),
                    hotel.getAvgRating() == null ? null : hotel.getAvgRating().doubleValue(),
                    hotel.getReviewCount(),
                    hotel.getPropertyType().name(),
                    List.copyOf(hotel.amenityCodes()),
                    hotelPlans.stream().anyMatch(RatePlan::hasFreeCancellation),
                    hotelPlans.stream().anyMatch(RatePlan::isBreakfastIncluded),
                    sellable.stream().mapToInt(room -> room.getMaxAdults() + room.getMaxChildren()).max().orElse(0),
                    hotelPlans.stream().map(RatePlan::getBasePricePerNight).min(Comparator.naturalOrder())
                            .map(Number::doubleValue).orElse(null),
                    Optional.ofNullable(covers.get(hotel.getId())).map(UUID::toString).orElse(null),
                    hotel.getDataSource().name()));
        }
        return documents;
    }

}
