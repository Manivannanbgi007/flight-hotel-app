package com.flighthotel.common.error;

import org.springframework.http.HttpStatus;

/** 409 — the request conflicts with the current state (duplicate, concurrent update, wrong status). */
public class ConflictException extends ApiException {

    public ConflictException(String code, String message) {
        super(HttpStatus.CONFLICT, code, message);
    }
}
