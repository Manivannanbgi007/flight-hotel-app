package com.flighthotel.identity.config;

import java.util.Map;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;

import com.flighthotel.common.config.CommonProperties;
import com.flighthotel.common.security.TokenRevocationStore;
import com.flighthotel.common.security.TokenRevocationValidator;
import com.flighthotel.identity.security.SigningKeyService;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;

@Configuration
@EnableConfigurationProperties(IdentityProperties.class)
public class IdentitySecurityConfig {

    /** BCrypt with cost 12. The {@code {bcrypt}} prefix allows moving to another algorithm later without a big-bang reset. */
    @Bean
    PasswordEncoder passwordEncoder() {
        return new DelegatingPasswordEncoder("bcrypt", Map.of("bcrypt", new BCryptPasswordEncoder(12)));
    }

    @Bean
    JwtEncoder jwtEncoder(SigningKeyService signingKeys) {
        return new NimbusJwtEncoder(signingKeys.signingSource());
    }

    /**
     * identity-service verifies tokens with its own keys directly instead of downloading its own JWKS over HTTP.
     * Same validators as every other service (issuer, expiry, revocation).
     */
    @Bean
    JwtDecoder jwtDecoder(SigningKeyService signingKeys, CommonProperties properties, TokenRevocationStore revocationStore) {
        DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, signingKeys.verificationSource()));
        // Expiry and other claims are checked by Spring's validators below.
        processor.setJWTClaimsSetVerifier((claims, context) -> { });
        NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(properties.security().issuer()),
                new TokenRevocationValidator(revocationStore)));
        return decoder;
    }

    /**
     * /api/auth/** works without an access token, and an expired one must not break logout or refresh, so the
     * Authorization header is ignored on those paths (logout reads it itself, see AuthController).
     */
    @Bean
    BearerTokenResolver bearerTokenResolver() {
        DefaultBearerTokenResolver delegate = new DefaultBearerTokenResolver();
        return request -> request.getRequestURI().startsWith("/api/auth/") ? null : delegate.resolve(request);
    }
}
