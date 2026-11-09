package com.flighthotel.search.web;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.error.ApiException;
import com.flighthotel.search.index.SearchCategory;
import com.flighthotel.search.query.SearchService;
import com.flighthotel.search.query.ViewerResolver;
import com.flighthotel.search.web.SearchDtos.SearchResponse;
import com.flighthotel.search.web.SearchDtos.SuggestResponse;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * The global search API. Works signed out (public results only) and signed in (plus the user's own records, or the
 * records their role may read). The user is always taken from the verified token, never from parameters.
 */
@RestController
@RequestMapping("/api/search")
@Tag(name = "Search", description = "Global search: hotels, destinations, bookings, payments, tickets, users and pages")
public class SearchController {

    static final int MIN_QUERY = 2;
    static final int MAX_QUERY = 100;
    static final int MAX_PAGE = 99;
    static final int MAX_SIZE = 50;

    private final SearchService search;
    private final ViewerResolver viewers;

    public SearchController(SearchService search, ViewerResolver viewers) {
        this.search = search;
        this.viewers = viewers;
    }

    @GetMapping("/suggest")
    @Operation(summary = "Suggestions while typing: the best few results of each category")
    public SuggestResponse suggest(@Parameter(description = "2 to 100 characters") @RequestParam(required = false) String q) {
        return search.suggest(validQuery(q), viewers.current());
    }

    @GetMapping
    @Operation(summary = "Search results: all categories grouped, or one category a page at a time")
    public SearchResponse search(
            @Parameter(description = "2 to 100 characters") @RequestParam(required = false) String q,
            @Parameter(description = "ALL or one category (HOTELS, BOOKINGS, ...)") @RequestParam(defaultValue = "ALL") String category,
            @Parameter(description = "Zero-based page, at most 99") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "1 to 50 results per page") @RequestParam(defaultValue = "10") int size) {
        String query = validQuery(q);
        SearchCategory chosen = null;
        if (!"ALL".equalsIgnoreCase(category)) {
            chosen = SearchCategory.parse(category).orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST,
                    "INVALID_CATEGORY", "Unknown category: use ALL or one of the search categories."));
        }
        if (page < 0 || page > MAX_PAGE || size < 1 || size > MAX_SIZE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
                    "page must be 0 to " + MAX_PAGE + " and size 1 to " + MAX_SIZE + ".");
        }
        return search.search(query, chosen, page, size, viewers.current());
    }

    /**
     * The query without control characters and extra spaces, 2 to 100 characters. The text is only ever used inside
     * match queries (no query_string), so wildcards and operators like {@code *} or {@code OR} have no special meaning.
     */
    static String validQuery(String q) {
        String query = q == null ? "" : q.replaceAll("\\p{Cntrl}", " ").strip().replaceAll("\\s+", " ");
        if (query.length() < MIN_QUERY) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "QUERY_TOO_SHORT", "Type at least 2 characters.");
        }
        if (query.length() > MAX_QUERY) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "QUERY_TOO_LONG", "Use at most 100 characters.");
        }
        return query;
    }
}
