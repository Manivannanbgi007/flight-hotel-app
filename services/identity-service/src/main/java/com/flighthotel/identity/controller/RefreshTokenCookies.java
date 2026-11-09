package com.flighthotel.identity.controller;

import java.time.Duration;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;
import org.springframework.web.util.WebUtils;

import com.flighthotel.identity.config.IdentityProperties;
import com.flighthotel.identity.exception.IdentityErrors;
import com.flighthotel.identity.service.impl.SessionService.NewRefreshToken;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * The refresh token lives in an HttpOnly cookie that JavaScript cannot read, scoped to {@code /api/auth} so it is
 * only sent to the refresh and logout endpoints.
 * <p>
 * CSRF: the cookie is {@code SameSite=Strict}, and in addition every cookie-based call must send
 * {@code X-Requested-With: XMLHttpRequest}. A cross-site HTML form cannot set that header, and a cross-site script
 * cannot send it without a CORS preflight, which the gateway only allows for our own origins.
 */
@Component
public class RefreshTokenCookies {

    static final String PATH = "/api/auth";
    static final String CSRF_HEADER = "X-Requested-With";
    static final String CSRF_HEADER_VALUE = "XMLHttpRequest";

    private final IdentityProperties properties;

    public RefreshTokenCookies(IdentityProperties properties) {
        this.properties = properties;
    }

    /** "Remember me" → persistent cookie; otherwise a session cookie (the token itself still expires after 1 day). */
    public void write(HttpServletResponse response, NewRefreshToken token) {
        ResponseCookie.ResponseCookieBuilder cookie = baseCookie(token.rawToken());
        if (token.rememberMe()) {
            cookie.maxAge(token.ttl());
        }
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.build().toString());
    }

    public void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, baseCookie("").maxAge(Duration.ZERO).build().toString());
    }

    public String read(HttpServletRequest request) {
        Cookie cookie = WebUtils.getCookie(request, properties.cookie().name());
        return cookie == null ? null : cookie.getValue();
    }

    public void requireCsrfHeader(HttpServletRequest request) {
        if (!CSRF_HEADER_VALUE.equals(request.getHeader(CSRF_HEADER))) {
            throw IdentityErrors.csrfCheckFailed();
        }
    }

    private ResponseCookie.ResponseCookieBuilder baseCookie(String value) {
        return ResponseCookie.from(properties.cookie().name(), value)
                .httpOnly(true)
                .secure(properties.cookie().secure())
                .sameSite("Strict")
                .path(PATH);
    }
}
