package com.flighthotel.common.security;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/** Rejects access tokens that were revoked (logout, deactivation, password reset). */
public class TokenRevocationValidator implements OAuth2TokenValidator<Jwt> {

    private static final OAuth2Error REVOKED = new OAuth2Error("invalid_token", "The token has been revoked", null);

    private final TokenRevocationStore store;

    public TokenRevocationValidator(TokenRevocationStore store) {
        this.store = store;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        return store.isRevoked(jwt.getId(), jwt.getSubject(), jwt.getIssuedAt())
                ? OAuth2TokenValidatorResult.failure(REVOKED)
                : OAuth2TokenValidatorResult.success();
    }
}
