package com.flighthotel.common.config;

import java.time.Clock;
import java.util.List;

import jakarta.servlet.DispatcherType;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;

import com.flighthotel.common.crypto.FieldEncryptor;
import com.flighthotel.common.security.ProblemDetailsSecurityHandler;
import com.flighthotel.common.security.RoleAndPermissionConverter;
import com.flighthotel.common.security.TokenRevocationStore;
import com.flighthotel.common.security.TokenRevocationValidator;

import tools.jackson.databind.json.JsonMapper;

/**
 * Every business service is an OAuth2 resource server: it validates the JWT itself (signature via identity-service's
 * JWKS, expiry, issuer) and does not trust the gateway blindly.
 * <p>
 * Endpoints are protected by default. Public ones are listed in {@code travel.security.public-paths}.
 * Role/permission checks happen in the service layer with {@code @PreAuthorize}.
 */
@AutoConfiguration(afterName = "org.springframework.boot.data.redis.autoconfigure.DataRedisAutoConfiguration", beforeName = {
        "org.springframework.boot.security.autoconfigure.web.servlet.ServletWebSecurityAutoConfiguration",
        "org.springframework.boot.security.autoconfigure.SecurityAutoConfiguration",
        "org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration",
        "org.springframework.boot.security.autoconfigure.actuate.web.servlet.ManagementWebSecurityAutoConfiguration",
        "org.springframework.boot.security.oauth2.server.resource.autoconfigure.OAuth2ResourceServerAutoConfiguration"
})
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@EnableConfigurationProperties(CommonProperties.class)
@EnableMethodSecurity
public class CommonSecurityAutoConfiguration {

    /** Always reachable: health checks, API docs and error dispatches. */
    private static final String[] INFRASTRUCTURE_PATHS = {
            "/actuator/health/**", "/actuator/info", "/actuator/prometheus",
            "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html", "/error"
    };

    @Bean
    @ConditionalOnMissingBean
    public TokenRevocationStore tokenRevocationStore(StringRedisTemplate redisTemplate, CommonProperties properties,
            Clock clock) {
        return new TokenRevocationStore(redisTemplate, properties.security().maxAccessTokenLifetime(), clock);
    }

    @Bean
    @ConditionalOnMissingBean
    public JwtDecoder jwtDecoder(CommonProperties properties, TokenRevocationStore revocationStore) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(properties.security().jwkSetUri()).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(properties.security().issuer()),
                new TokenRevocationValidator(revocationStore)));
        return decoder;
    }

    /** Only in services that store encrypted fields (they set {@code travel.security.data-encryption-key}). */
    @Bean
    @ConditionalOnMissingBean
    @ConditionalOnProperty(prefix = "travel.security", name = "data-encryption-key")
    public FieldEncryptor fieldEncryptor(CommonProperties properties) {
        return new FieldEncryptor(properties.security().dataEncryptionKey());
    }

    @Bean
    @ConditionalOnMissingBean
    public ProblemDetailsSecurityHandler problemDetailsSecurityHandler(JsonMapper jsonMapper) {
        return new ProblemDetailsSecurityHandler(jsonMapper);
    }

    @Bean
    @ConditionalOnMissingBean(SecurityFilterChain.class)
    public SecurityFilterChain securityFilterChain(HttpSecurity http, CommonProperties properties,
            ProblemDetailsSecurityHandler problemHandler) throws Exception {
        JwtAuthenticationConverter jwtConverter = new JwtAuthenticationConverter();
        jwtConverter.setJwtGrantedAuthoritiesConverter(new RoleAndPermissionConverter());

        http
                // Stateless bearer-token API: no session, no cookies → CSRF protection is not applicable here.
                // (identity-service adds CSRF protection to its cookie-based refresh endpoint.)
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .headers(h -> h.contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'none'; frame-ancestors 'none'")))
                .authorizeHttpRequests(auth -> {
                    // Async (SSE) and error dispatches were already authorized on the original request.
                    auth.dispatcherTypeMatchers(DispatcherType.ASYNC, DispatcherType.ERROR).permitAll();
                    auth.requestMatchers(INFRASTRUCTURE_PATHS).permitAll();
                    for (PublicPath path : parse(properties.security().publicPaths())) {
                        if (path.method() == null) {
                            auth.requestMatchers(path.pattern()).permitAll();
                        } else {
                            auth.requestMatchers(path.method(), path.pattern()).permitAll();
                        }
                    }
                    auth.anyRequest().authenticated();
                })
                .oauth2ResourceServer(oauth -> oauth
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtConverter))
                        .authenticationEntryPoint(problemHandler)
                        .accessDeniedHandler(problemHandler))
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(problemHandler)
                        .accessDeniedHandler(problemHandler));
        return http.build();
    }

    /** {@code "GET /api/hotels/**"} → (GET, /api/hotels/**); {@code "/api/auth/**"} → (any method, /api/auth/**). */
    static List<PublicPath> parse(List<String> entries) {
        return entries.stream().map(String::trim).filter(e -> !e.isEmpty()).map(entry -> {
            int space = entry.indexOf(' ');
            if (space < 0) {
                return new PublicPath(null, entry);
            }
            return new PublicPath(HttpMethod.valueOf(entry.substring(0, space).toUpperCase()),
                    entry.substring(space + 1).trim());
        }).toList();
    }

    record PublicPath(HttpMethod method, String pattern) {
    }
}
