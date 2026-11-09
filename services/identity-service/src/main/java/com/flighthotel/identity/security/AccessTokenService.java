package com.flighthotel.identity.security;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

import com.flighthotel.common.config.CommonProperties;
import com.flighthotel.common.id.UuidV7;
import com.flighthotel.common.security.JwtClaims;
import com.flighthotel.identity.config.IdentityProperties;
import com.flighthotel.identity.entity.User;

/** Issues short-lived RS256 access tokens (claims: API_DOCUMENTATION.md §2). */
@Component
public class AccessTokenService {

    public static final String SESSION_CLAIM = "sid";

    private final JwtEncoder encoder;
    private final SigningKeyService signingKeys;
    private final IdentityProperties properties;
    private final String issuer;
    private final Clock clock;

    public AccessTokenService(JwtEncoder encoder, SigningKeyService signingKeys, IdentityProperties properties,
            CommonProperties commonProperties, Clock clock) {
        this.encoder = encoder;
        this.signingKeys = signingKeys;
        this.properties = properties;
        this.issuer = commonProperties.security().issuer();
        this.clock = clock;
    }

    public IssuedAccessToken issue(User user, UUID sessionId) {
        // JWT times have second precision; truncating keeps "revoked before" comparisons exact.
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        Instant expiresAt = now.plus(properties.tokens().accessTokenTtl());
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .subject(user.getId().toString())
                .issuedAt(now)
                .expiresAt(expiresAt)
                .id(UuidV7.generate().toString())
                .claim(JwtClaims.EMAIL, user.getEmail())
                .claim("given_name", user.getFirstName())
                .claim(JwtClaims.ROLES, List.copyOf(user.roleNames()))
                .claim(JwtClaims.PERMISSIONS, List.copyOf(user.permissionCodes()))
                .claim(SESSION_CLAIM, sessionId.toString())
                .build();
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(signingKeys.activeKeyId()).type("JWT").build();
        String value = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new IssuedAccessToken(value, expiresAt, properties.tokens().accessTokenTtl().toSeconds());
    }

    public record IssuedAccessToken(String value, Instant expiresAt, long expiresInSeconds) {
    }
}
