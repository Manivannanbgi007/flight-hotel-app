package com.flighthotel.gateway.config;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.ReactiveJwtAuthenticationConverterAdapter;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.security.web.server.authentication.HttpStatusServerEntryPoint;
import org.springframework.security.web.server.authorization.HttpStatusServerAccessDeniedHandler;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsConfigurationSource;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;

/**
 * First line of defence: rejects requests without a valid token before they reach a service, and keeps signed-in
 * users out of staff areas their role has nothing to do with ({@code gateway.role-paths}).
 * Services validate the token again and do the exact role/permission checks themselves.
 */
@Configuration
@EnableWebFluxSecurity
public class GatewaySecurityConfig {

    private static final String[] ALWAYS_PUBLIC = {
            "/actuator/health/**", "/actuator/info",
            "/swagger-ui.html", "/swagger-ui/**", "/webjars/**", "/v3/api-docs/**", "/api-docs/**"
    };

    @Bean
    SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http, GatewayProperties properties) {
        JwtAuthenticationConverter jwtConverter = new JwtAuthenticationConverter();
        jwtConverter.setJwtGrantedAuthoritiesConverter(new RolesConverter());

        http
                // Bearer tokens in headers, no session cookies → CSRF does not apply at the gateway.
                .csrf(ServerHttpSecurity.CsrfSpec::disable)
                .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
                .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
                .logout(ServerHttpSecurity.LogoutSpec::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource(properties)))
                .authorizeExchange(exchange -> {
                    exchange.pathMatchers(HttpMethod.OPTIONS).permitAll();
                    exchange.pathMatchers(ALWAYS_PUBLIC).permitAll();
                    for (String entry : properties.publicPaths()) {
                        String trimmed = entry.trim();
                        int space = trimmed.indexOf(' ');
                        if (space < 0) {
                            exchange.pathMatchers(trimmed).permitAll();
                        } else {
                            exchange.pathMatchers(HttpMethod.valueOf(trimmed.substring(0, space).toUpperCase()),
                                    trimmed.substring(space + 1).trim()).permitAll();
                        }
                    }
                    for (String entry : properties.rolePaths()) {
                        String[] parts = entry.trim().split("\\s+");
                        if (parts.length != 2) {
                            throw new IllegalStateException("gateway.role-paths entry must be '<pattern> <ROLE,ROLE>': " + entry);
                        }
                        exchange.pathMatchers(parts[0]).hasAnyRole(parts[1].split(","));
                    }
                    exchange.anyExchange().authenticated();
                })
                .oauth2ResourceServer(oauth -> oauth
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(new ReactiveJwtAuthenticationConverterAdapter(jwtConverter)))
                        .authenticationEntryPoint(new HttpStatusServerEntryPoint(HttpStatus.UNAUTHORIZED)))
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(new HttpStatusServerEntryPoint(HttpStatus.UNAUTHORIZED))
                        .accessDeniedHandler(new HttpStatusServerAccessDeniedHandler(HttpStatus.FORBIDDEN)));
        return http.build();
    }

    @Bean
    ReactiveJwtDecoder reactiveJwtDecoder(GatewayProperties properties) {
        NimbusReactiveJwtDecoder decoder = NimbusReactiveJwtDecoder.withJwkSetUri(properties.jwkSetUri()).build();
        decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(properties.issuer()));
        return decoder;
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(GatewayProperties properties) {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(properties.allowedOrigins());
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "Idempotency-Key",
                "X-Correlation-Id", "X-Requested-With", "Last-Event-ID"));
        cors.setExposedHeaders(List.of("X-Correlation-Id", "Retry-After", "Content-Disposition",
                "X-RateLimit-Remaining"));
        // Needed for the HttpOnly refresh-token cookie on /api/auth/refresh.
        cors.setAllowCredentials(true);
        cors.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cors);
        return source;
    }

    /** Token claim {@code roles: ["ADMIN"]} → authority {@code ROLE_ADMIN}. */
    static class RolesConverter implements Converter<Jwt, Collection<GrantedAuthority>> {
        @Override
        public Collection<GrantedAuthority> convert(Jwt jwt) {
            List<GrantedAuthority> authorities = new ArrayList<>();
            Object roles = jwt.getClaim("roles");
            if (roles instanceof Collection<?> values) {
                values.forEach(role -> authorities.add(new SimpleGrantedAuthority("ROLE_" + role)));
            }
            return authorities;
        }
    }
}
