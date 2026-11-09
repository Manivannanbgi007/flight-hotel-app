package com.flighthotel.identity.exception;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;

import com.flighthotel.common.error.ApiException;

/** The identity-specific errors (codes in API_DOCUMENTATION.md §1). Messages are safe to show to users. */
public final class IdentityErrors {

    private IdentityErrors() {
    }

    /** Same message whether the email or the password was wrong, so accounts cannot be discovered. */
    public static ApiException invalidCredentials() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Wrong email or password");
    }

    public static ApiException emailNotVerified() {
        return new ApiException(HttpStatus.FORBIDDEN, "EMAIL_NOT_VERIFIED",
                "Please verify your email address first. Check your inbox for the verification link.");
    }

    public static ApiException accountDisabled() {
        return new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_DISABLED",
                "This account has been deactivated. Please contact support.");
    }

    public static ApiException accountLocked(Instant lockedUntil) {
        return new ApiException(HttpStatus.LOCKED, "ACCOUNT_LOCKED",
                "Too many failed attempts. The account is temporarily locked.",
                Map.of("lockedUntil", lockedUntil.toString()));
    }

    /**
     * The password was right, but the account has no role for this sign-in page (Phase 11). {@code details.portals}:
     * the sign-in pages the account may use, so the page can send the user to the right one.
     */
    public static ApiException portalNotAllowed(List<String> portals) {
        return new ApiException(HttpStatus.FORBIDDEN, "PORTAL_NOT_ALLOWED",
                "This account cannot sign in here. Please use the sign-in page for your role.",
                Map.of("portals", portals));
    }

    public static ApiException invalidOrExpiredToken() {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_OR_EXPIRED_TOKEN",
                "This link is invalid or has expired. Please request a new one.");
    }

    public static ApiException csrfCheckFailed() {
        return new ApiException(HttpStatus.FORBIDDEN, "CSRF_CHECK_FAILED", "Request blocked");
    }

    /** Thrown inside a transaction that must still commit (e.g. revoking a stolen session), see SessionService. */
    public static final class SessionExpiredException extends ApiException {
        public SessionExpiredException() {
            super(HttpStatus.UNAUTHORIZED, "SESSION_EXPIRED", "Your session has expired. Please log in again.");
        }
    }
}
