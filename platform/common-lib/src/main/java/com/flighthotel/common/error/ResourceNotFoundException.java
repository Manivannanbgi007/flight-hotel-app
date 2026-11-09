package com.flighthotel.common.error;

import java.util.Map;

import org.springframework.http.HttpStatus;

/** 404 — the requested resource does not exist (or the caller is not allowed to know it exists). */
public class ResourceNotFoundException extends ApiException {

    public ResourceNotFoundException(String resourceName, Object id) {
        super(HttpStatus.NOT_FOUND,
                toCode(resourceName) + "_NOT_FOUND",
                resourceName + " not found",
                Map.of("id", String.valueOf(id)));
    }

    private static String toCode(String resourceName) {
        return resourceName.trim().replaceAll("([a-z])([A-Z])", "$1_$2").replace(' ', '_').toUpperCase();
    }
}
