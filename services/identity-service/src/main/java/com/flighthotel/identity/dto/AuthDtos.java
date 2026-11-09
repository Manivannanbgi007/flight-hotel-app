package com.flighthotel.identity.dto;

import java.util.Set;
import java.util.UUID;

import com.flighthotel.identity.security.Portal;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Request and response bodies of /api/auth (see API_DOCUMENTATION.md §2). */
public final class AuthDtos {

    /** Letters (any language), spaces, dot, apostrophe, hyphen; must start with a letter. */
    public static final String NAME_PATTERN = "^[\\p{L}][\\p{L} .'-]{0,79}$";
    public static final String PHONE_PATTERN = "^\\+?[0-9]{7,15}$";

    private AuthDtos() {
    }

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(min = 10, max = 64) String password,
            @NotBlank @Pattern(regexp = NAME_PATTERN, message = "must contain only letters, spaces, . ' -") String firstName,
            @NotBlank @Pattern(regexp = NAME_PATTERN, message = "must contain only letters, spaces, . ' -") String lastName,
            @Pattern(regexp = PHONE_PATTERN, message = "must be 7-15 digits, optionally starting with +") String phone,
            @AssertTrue(message = "must be accepted") boolean acceptTerms) {
    }

    /**
     * @param portal optional (Phase 11): the sign-in page used, {@code CUSTOMER | ADMIN | HOTEL_MANAGER | SUPPORT};
     *               an account without a role for it gets {@code 403 PORTAL_NOT_ALLOWED}. Without it: any role.
     */
    public record LoginRequest(
            @NotBlank @Size(max = 254) String email,
            @NotBlank @Size(max = 128) String password,
            boolean rememberMe,
            @Pattern(regexp = Portal.NAMES, message = "must be CUSTOMER, ADMIN, HOTEL_MANAGER or SUPPORT") String portal) {
    }

    public record EmailRequest(@NotBlank @Email @Size(max = 254) String email) {
    }

    public record TokenRequest(@NotBlank @Size(max = 100) String token) {
    }

    public record ResetPasswordRequest(
            @NotBlank @Size(max = 100) String token,
            @NotBlank @Size(min = 10, max = 64) String newPassword) {
    }

    public record MessageResponse(String message) {
    }

    /** The logged-in user as the frontend needs it right after login/refresh. */
    public record AuthUser(UUID id, String email, String firstName, String lastName, Set<String> roles,
                           Set<String> permissions, boolean emailVerified, boolean hasPhoto) {
    }

    public record AuthResponse(String accessToken, String tokenType, long expiresIn, AuthUser user) {

        public static AuthResponse bearer(String accessToken, long expiresInSeconds, AuthUser user) {
            return new AuthResponse(accessToken, "Bearer", expiresInSeconds, user);
        }
    }
}
