package com.flighthotel.common.error;

import org.springframework.http.HttpStatus;

/** 403 — the user is authenticated but may not perform this operation on this resource. */
public class ForbiddenOperationException extends ApiException {

    public ForbiddenOperationException(String message) {
        super(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
    }
}
