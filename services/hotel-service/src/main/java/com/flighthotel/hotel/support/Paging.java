package com.flighthotel.hotel.support;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

/**
 * Page requests from clients: the page size is capped and only whitelisted fields can be sorted on
 * (SECURITY_GUIDE.md §6 rule 5); anything else falls back to the default order. The id is always the last sort key,
 * so pages never overlap when the sorted values are equal.
 */
public final class Paging {

    public static final int MAX_SIZE = 100;

    private Paging() {
    }

    public static PageRequest of(Pageable requested, Set<String> sortable, Sort fallback) {
        List<Sort.Order> orders = new ArrayList<>();
        requested.getSort().forEach(order -> {
            if (sortable.contains(order.getProperty())) {
                orders.add(order);
            }
        });
        Sort sort = orders.isEmpty() ? fallback : Sort.by(orders);
        Sort.Direction tieBreak = sort.stream().findFirst().map(Sort.Order::getDirection).orElse(Sort.Direction.DESC);
        return PageRequest.of(Math.max(requested.getPageNumber(), 0), size(requested.getPageSize()),
                sort.and(Sort.by(tieBreak, "id")));
    }

    public static PageRequest of(int page, int size, Sort sort) {
        return PageRequest.of(Math.max(page, 0), size(size), sort);
    }

    public static int size(int requested) {
        return Math.min(Math.max(requested, 1), MAX_SIZE);
    }
}
