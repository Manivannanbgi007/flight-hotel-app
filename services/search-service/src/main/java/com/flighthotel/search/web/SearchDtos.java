package com.flighthotel.search.web;

import java.util.List;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.search.index.SearchCategory;

/**
 * What the search API returns (docs/GLOBAL_SEARCH_IMPLEMENTATION.md §2). Never raw Elasticsearch documents: no
 * internal fields, no access data, no identifiers lists. Highlights are plain text segments, never HTML.
 */
public final class SearchDtos {

    private SearchDtos() {
    }

    /** A piece of text; {@code match} = it matched the query (shown highlighted). */
    public record TextSegment(String text, boolean match) {
    }

    /** A status chip: label and colour ({@code neutral}, {@code info}, {@code success}, {@code warning}, {@code danger}). */
    public record Status(String label, String tone) {
    }

    public record Meta(String label, String value) {
    }

    public record Action(String label, String url) {
    }

    public record Highlight(List<TextSegment> title, List<TextSegment> subtitle, List<TextSegment> snippet) {
    }

    /** One result; {@code url} is an internal application path (starts with "/"). */
    public record SearchResult(String id, SearchCategory category, String title, String subtitle, String snippet,
            String url, Status status, List<Meta> meta, List<Action> actions, Highlight highlight) {
    }

    public record ResultGroup(SearchCategory category, String label, long total, List<SearchResult> items) {
    }

    public record CategoryCount(SearchCategory category, String label, long total) {
    }

    /** {@code GET /api/search/suggest}: the best few results per category, best category first. */
    public record SuggestResponse(String query, long tookMs, List<ResultGroup> groups) {
    }

    /**
     * {@code GET /api/search}. For category ALL: {@code groups} holds up to 5 results of each category and
     * {@code results} is null; for one category: {@code results} holds the page and {@code groups} is empty.
     */
    public record SearchResponse(String query, long tookMs, String category, String interpretation,
            List<CategoryCount> categories, long total, List<ResultGroup> groups, PageResponse<SearchResult> results) {
    }
}
