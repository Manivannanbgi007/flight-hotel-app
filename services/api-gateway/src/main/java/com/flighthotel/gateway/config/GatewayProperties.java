package com.flighthotel.gateway.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Gateway-specific settings ({@code gateway.*}).
 *
 * @param jwkSetUri      identity-service public keys
 * @param issuer         expected JWT issuer
 * @param allowedOrigins browser origins allowed by CORS
 * @param publicPaths    endpoints reachable without a token, optional method prefix ({@code "GET /api/hotels/**"}).
 *                       Must match the services' {@code travel.security.public-paths}.
 * @param rolePaths      staff areas and the roles that may call them at all ({@code "/api/admin/** ADMIN,SUPPORT_AGENT"}).
 *                       A coarse first check: other signed-in users get 403 here, before any service reads the body.
 *                       The services still check the exact permission.
 */
@ConfigurationProperties("gateway")
public record GatewayProperties(
        @DefaultValue("http://localhost:8101/.well-known/jwks.json") String jwkSetUri,
        @DefaultValue("flight-hotel-identity") String issuer,
        @DefaultValue("http://localhost:5173") List<String> allowedOrigins,
        @DefaultValue List<String> publicPaths,
        @DefaultValue List<String> rolePaths) {
}
