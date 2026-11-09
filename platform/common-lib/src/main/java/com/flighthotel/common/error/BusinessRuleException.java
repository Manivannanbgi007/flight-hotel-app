package com.flighthotel.common.error;

import java.util.Map;

import org.springframework.http.HttpStatus;

/** 422 — the request is valid but breaks a business rule (for example "coupon expired"). */
public class BusinessRuleException extends ApiException {

    public BusinessRuleException(String code, String message) {
        super(HttpStatus.UNPROCESSABLE_CONTENT, code, message);
    }

    public BusinessRuleException(String code, String message, Map<String, Object> details) {
        super(HttpStatus.UNPROCESSABLE_CONTENT, code, message, details);
    }
}
