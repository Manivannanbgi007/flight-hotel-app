package com.flighthotel.common.web;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Client IP and user agent of the current request, for login history and audit logs.
 * <p>
 * The IP is the real client address because {@code server.forward-headers-strategy=framework} applies the gateway's
 * {@code X-Forwarded-For}. Services must only be reachable through the gateway (enforced by network rules).
 */
public final class ClientRequestInfo {

    private static final int MAX_USER_AGENT = 255;

    private ClientRequestInfo() {
    }

    public static String ipAddress() {
        HttpServletRequest request = currentRequest();
        return request == null ? null : request.getRemoteAddr();
    }

    public static String userAgent() {
        HttpServletRequest request = currentRequest();
        if (request == null) {
            return null;
        }
        String userAgent = request.getHeader("User-Agent");
        if (userAgent == null) {
            return null;
        }
        String cleaned = userAgent.replaceAll("[\\r\\n\\t]", " ");
        return cleaned.length() > MAX_USER_AGENT ? cleaned.substring(0, MAX_USER_AGENT) : cleaned;
    }

    private static HttpServletRequest currentRequest() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        return attributes instanceof ServletRequestAttributes servlet ? servlet.getRequest() : null;
    }
}
