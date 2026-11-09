package com.flighthotel.search.index;

import java.io.IOException;
import java.io.StringReader;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.stereotype.Component;

import co.elastic.clients.elasticsearch.ElasticsearchClient;
import co.elastic.clients.elasticsearch._types.Conflicts;
import co.elastic.clients.elasticsearch._types.ElasticsearchException;
import co.elastic.clients.elasticsearch._types.Script;
import co.elastic.clients.elasticsearch._types.ScriptLanguage;
import co.elastic.clients.elasticsearch.core.BulkRequest;
import co.elastic.clients.elasticsearch.core.BulkResponse;
import co.elastic.clients.elasticsearch.core.GetResponse;
import co.elastic.clients.json.JsonData;
import tools.jackson.databind.json.JsonMapper;

/**
 * Every write to the search index goes through here. Writes are <b>idempotent</b>: applying the same event twice gives
 * the same document, so replays and Kafka redeliveries are harmless. Two kinds of change:
 * <ul>
 *   <li>{@link #replaceState}: an event that carries the whole record (BookingSnapshot, SupportTicketSnapshot, ...).
 *       The newest state wins; an older state that arrives late only fills fields that are still empty.</li>
 *   <li>{@link #merge}: an event that adds details (the guests' names, the PNR, a payment outcome). Lists are joined,
 *       and a status can be ranked so a late "failed" never replaces "completed".</li>
 * </ul>
 * Both are Painless scripts run inside Elasticsearch ({@code scripted_upsert}), so the check and the write happen in one
 * step even when two events about the same record arrive at once.
 */
@Component
public class IndexWriter {

    /** Newer state wins (by rank, then time); an older state only fills fields that are still empty. */
    static final String FULL_STATE = """
            def doc = ctx._source;
            long at = params.stateAt;
            int rank = params.rank;
            int docRank = doc.stateRank == null ? 0 : ((Number) doc.stateRank).intValue();
            long docAt = doc.stateAt == null ? -1L : ((Number) doc.stateAt).longValue();
            boolean newer = rank > docRank || (rank == docRank && at >= docAt);
            for (entry in params.fields.entrySet()) {
              if (newer || doc[entry.getKey()] == null) {
                doc[entry.getKey()] = entry.getValue();
              }
            }
            if (newer) {
              for (name in params.owned) {
                if (!params.fields.containsKey(name)) { doc.remove(name); }
              }
              doc.stateAt = at;
              doc.stateRank = rank;
            }
            doc.complete = true;
            """;

    /** Adds details: lists are joined (when union), other values replaced; optional ranked status and time. */
    static final String MERGE = """
            def doc = ctx._source;
            for (entry in params.fields.entrySet()) {
              def value = entry.getValue();
              def current = doc[entry.getKey()];
              if (params.union && value instanceof List) {
                List merged = new ArrayList();
                if (current instanceof List) { merged.addAll(current); } else if (current != null) { merged.add(current); }
                for (item in value) { if (!merged.contains(item)) { merged.add(item); } }
                doc[entry.getKey()] = merged;
              } else {
                doc[entry.getKey()] = value;
              }
            }
            for (entry in params.ifAbsent.entrySet()) {
              if (doc[entry.getKey()] == null) { doc[entry.getKey()] = entry.getValue(); }
            }
            if (params.stateAt != null) {
              long at = params.stateAt;
              if (doc.stateAt == null || at > ((Number) doc.stateAt).longValue()) { doc.stateAt = at; }
            }
            if (params.status != null) {
              int docRank = doc.stateRank == null ? 0 : ((Number) doc.stateRank).intValue();
              if (params.rank >= docRank) { doc.status = params.status; doc.stateRank = params.rank; }
            }
            if (params.complete) { doc.complete = true; } else if (doc.complete == null) { doc.complete = false; }
            """;

    /** Copies a booking's reference onto payments and refunds that were indexed before the booking. */
    static final String FILL_BOOKING_REFERENCE = """
            def doc = ctx._source;
            doc.reference = params.reference;
            doc.title = (doc.category == 'PAYMENTS' ? 'Payment for ' : 'Refund for ') + params.reference;
            List ids = new ArrayList();
            if (doc.identifiers instanceof List) { ids.addAll(doc.identifiers); } else if (doc.identifiers != null) { ids.add(doc.identifiers); }
            for (item in params.identifiers) { if (!ids.contains(item)) { ids.add(item); } }
            doc.identifiers = ids;
            if (params.bookingTitle != null) {
              List words = new ArrayList();
              if (doc.keywords instanceof List) { words.addAll(doc.keywords); } else if (doc.keywords != null) { words.add(doc.keywords); }
              if (!words.contains(params.bookingTitle)) { words.add(params.bookingTitle); }
              doc.keywords = words;
            }
            if (params.type != null) { doc.type = params.type; }
            """;

    private final ElasticsearchClient elasticsearch;
    private final SearchIndex index;
    private final JsonMapper json;

    public IndexWriter(ElasticsearchClient elasticsearch, SearchIndex index, JsonMapper json) {
        this.elasticsearch = elasticsearch;
        this.index = index;
        this.json = json;
    }

    /**
     * Writes the whole state of a record.
     *
     * @param stateAt when the state was taken (the event's {@code changedAt}); decides which of two states is newer
     * @param owned   every field this kind of event may write: a field missing from a newer state is removed
     */
    public void replaceState(SearchCategory category, String entityId, Instant stateAt, Fields fields,
            Collection<String> owned) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("fields", fields.asMap());
        params.put("stateAt", stateAt.toEpochMilli());
        params.put("rank", 0);
        params.put("owned", List.copyOf(owned));
        upsert(category.docId(entityId), FULL_STATE, params);
    }

    /** Adds details to a record (creating a not-yet-searchable stub if its main event has not arrived yet). */
    public void merge(SearchCategory category, String entityId, Merge merge) {
        Map<String, Object> fields = new LinkedHashMap<>(merge.fields.asMap());
        // The stub must know what it is, so the main event and the access rules find it.
        fields.put("category", category.name());
        fields.put("entityId", entityId);
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("fields", fields);
        params.put("ifAbsent", merge.ifAbsent.asMap());
        params.put("union", merge.union);
        params.put("stateAt", merge.stateAt == null ? null : merge.stateAt.toEpochMilli());
        params.put("status", merge.status);
        params.put("rank", merge.rank);
        params.put("complete", merge.complete);
        upsert(category.docId(entityId), MERGE, params);
    }

    /** One document as stored, if it exists. */
    @SuppressWarnings({ "unchecked", "rawtypes" })
    public Optional<Map<String, Object>> find(SearchCategory category, String entityId) {
        GetResponse<Map> response = call("read " + category.docId(entityId),
                () -> elasticsearch.get(g -> g.index(index.alias()).id(category.docId(entityId)), Map.class));
        return response.found() ? Optional.of((Map<String, Object>) response.source()) : Optional.empty();
    }

    /**
     * Payments and refunds can be indexed before their booking (they come from another topic). When the booking
     * arrives, its reference is copied onto them, so a search for the reference finds them too.
     */
    public void fillBookingReference(String bookingId, String reference, String bookingTitle, String contactEmail,
            String bookingType) {
        Map<String, Object> params = new HashMap<>();
        params.put("reference", reference);
        params.put("identifiers", Fields.partial().add("ids", reference, contactEmail).asMap().getOrDefault("ids", List.of()));
        params.put("bookingTitle", bookingTitle);
        params.put("type", bookingType);
        Map<String, Object> body = Map.of(
                "query", Map.of("bool", Map.of(
                        "filter", List.of(
                                Map.of("terms", Map.of("category", List.of("PAYMENTS", "REFUNDS"))),
                                Map.of("term", Map.of("bookingId", bookingId))),
                        "must_not", List.of(Map.of("exists", Map.of("field", "reference"))))),
                "script", Map.of("lang", "painless", "source", FILL_BOOKING_REFERENCE, "params", params));
        // update_by_query searches, and a search only sees what was refreshed: refresh first, so a payment indexed a
        // moment ago is found too. (Called once per booking, when it first gets its reference.)
        refresh();
        call("fill booking reference", () -> elasticsearch.updateByQuery(u -> u.index(index.alias())
                .conflicts(Conflicts.Proceed).withJson(new StringReader(json.writeValueAsString(body)))));
    }

    /** Replaces whole documents of one category in one bulk request (pages, destinations). */
    public void indexAll(SearchCategory category, List<Fields> documents) {
        if (documents.isEmpty()) {
            return;
        }
        BulkRequest.Builder bulk = new BulkRequest.Builder();
        for (Fields document : documents) {
            Map<String, Object> source = new LinkedHashMap<>(document.asMap());
            source.put("complete", true);
            String id = category.docId(String.valueOf(source.get("entityId")));
            bulk.operations(op -> op.index(idx -> idx.index(index.alias()).id(id).document(source)));
        }
        BulkResponse response = call("bulk " + category, () -> elasticsearch.bulk(bulk.build()));
        if (response.errors()) {
            throw new IllegalStateException("Bulk indexing of " + category + " reported errors: "
                    + response.items().stream().filter(item -> item.error() != null).findFirst()
                            .map(item -> item.error().reason()).orElse("?"));
        }
    }

    /** Removes the documents of a category whose record is not in the list any more (a page or destination removed). */
    public long deleteAllExcept(SearchCategory category, Collection<String> entityIds) {
        Map<String, Object> body = Map.of("query", Map.of("bool", Map.of(
                "filter", List.of(Map.of("term", Map.of("category", category.name()))),
                "must_not", List.of(Map.of("terms", Map.of("entityId", new ArrayList<>(entityIds)))))));
        Long deleted = call("clean " + category, () -> elasticsearch.deleteByQuery(d -> d.index(index.alias())
                .conflicts(Conflicts.Proceed).withJson(new StringReader(json.writeValueAsString(body))))).deleted();
        return deleted == null ? 0 : deleted;
    }

    /** Makes recent writes searchable now (tests and the admin replay; normally Elasticsearch does it every second). */
    public void refresh() {
        call("refresh", () -> elasticsearch.indices().refresh(r -> r.index(index.alias())));
    }

    private void upsert(String docId, String script, Map<String, Object> params) {
        Map<String, JsonData> scriptParams = new LinkedHashMap<>();
        // A missing parameter reads as null in Painless, so null values are simply left out.
        params.forEach((name, value) -> {
            if (value != null) {
                scriptParams.put(name, JsonData.of(value));
            }
        });
        Script painless = Script.of(s -> s.source(src -> src.scriptString(script)).lang(ScriptLanguage.Painless)
                .params(scriptParams));
        call("update " + docId, () -> elasticsearch.update(u -> u.index(index.alias()).id(docId).retryOnConflict(5)
                .scriptedUpsert(true).upsert(Map.of()).script(painless), Map.class));
    }

    /**
     * Runs one Elasticsearch call. Connection problems and overload become {@link SearchIndexUnavailableException}
     * (the Kafka listener then waits and retries); a refused document becomes {@link IllegalArgumentException}
     * (retrying cannot fix it, so the event goes to the dead-letter topic).
     */
    private <T> T call(String what, ElasticsearchCall<T> call) {
        index.ensureReady();
        try {
            return call.run();
        } catch (IOException ex) {
            throw new SearchIndexUnavailableException("Elasticsearch is not reachable (" + what + ")", ex);
        } catch (ElasticsearchException ex) {
            if (ex.status() >= 500 || ex.status() == 429) {
                throw new SearchIndexUnavailableException("Elasticsearch could not " + what, ex);
            }
            throw new IllegalArgumentException("Elasticsearch refused to " + what + ": " + ex.getMessage(), ex);
        }
    }

    @FunctionalInterface
    private interface ElasticsearchCall<T> {
        T run() throws IOException;
    }

    /**
     * A partial update for {@link #merge}: the fields to set, fields to set only when still empty, whether lists are
     * joined, an optional event time, an optional ranked status, and whether the record is now complete enough to be
     * shown in results.
     */
    public static final class Merge {
        private final Fields fields;
        private Fields ifAbsent = Fields.partial();
        private boolean union;
        private Instant stateAt;
        private String status;
        private int rank;
        private boolean complete;

        private Merge(Fields fields) {
            this.fields = fields;
        }

        public static Merge of(Fields fields) {
            return new Merge(fields);
        }

        /** Lists are added to what the document already has, instead of replacing it. */
        public Merge union() {
            this.union = true;
            return this;
        }

        /** These fields are only written when the document does not have them yet. */
        public Merge ifAbsent(Fields values) {
            this.ifAbsent = values;
            return this;
        }

        /** The event time: the document remembers the newest one, so an older full state cannot undo this change. */
        public Merge at(Instant time) {
            this.stateAt = time;
            return this;
        }

        /** Sets the status unless the document already has one of a higher rank (e.g. COMPLETED beats FAILED). */
        public Merge status(String value, int statusRank) {
            this.status = value;
            this.rank = statusRank;
            return this;
        }

        /** This event alone is enough to show the record in results. */
        public Merge complete() {
            this.complete = true;
            return this;
        }
    }
}
