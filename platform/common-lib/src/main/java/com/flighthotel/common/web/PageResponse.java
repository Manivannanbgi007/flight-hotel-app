package com.flighthotel.common.web;

import java.util.List;
import java.util.function.Function;

import org.springframework.data.domain.Page;

/** The one shape used by every paginated API response. Never return Spring's {@code Page} directly. */
public record PageResponse<T>(List<T> content, int page, int size, long totalElements, int totalPages) {

    public static <T> PageResponse<T> from(Page<T> page) {
        return new PageResponse<>(page.getContent(), page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages());
    }

    public static <E, T> PageResponse<T> from(Page<E> page, Function<E, T> mapper) {
        return from(page.map(mapper));
    }
}
