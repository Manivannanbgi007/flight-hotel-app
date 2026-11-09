package com.flighthotel.mcpserver.security;

import jakarta.servlet.DispatcherType;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

import com.flighthotel.common.security.ProblemDetailsSecurityHandler;
import com.flighthotel.common.security.RoleAndPermissionConverter;
import com.flighthotel.mcpserver.config.McpServerProperties;

/**
 * Two locks on the MCP endpoint:
 * <ol>
 * <li>the internal API key ({@link ApiKeyFilter}): only mcp-client-service gets in at all;</li>
 * <li>the user's access token, validated like in every other service (common-lib's {@code JwtDecoder}: JWKS
 * signature, issuer, expiry, revocation in Redis). A broken or revoked token is refused with 401. Without a token
 * the protocol handshake still works, but {@code tools/list} is empty and every tool answers "not signed in".</li>
 * </ol>
 * Nothing else is exposed except the health probes.
 */
@Configuration
public class McpSecurityConfig {

    @Bean
    SecurityFilterChain mcpSecurityFilterChain(HttpSecurity http, McpServerProperties properties,
            ProblemDetailsSecurityHandler problemHandler,
            @Value("${spring.ai.mcp.server.streamable-http.mcp-endpoint:/mcp}") String mcpEndpoint) throws Exception {
        JwtAuthenticationConverter jwtConverter = new JwtAuthenticationConverter();
        jwtConverter.setJwtGrantedAuthoritiesConverter(new RoleAndPermissionConverter());

        http
                // Server-to-server calls with headers only: no session, no cookies, so CSRF does not apply.
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .headers(h -> h.contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'none'")))
                .addFilterBefore(new ApiKeyFilter(properties.apiKey(), mcpEndpoint),
                        BearerTokenAuthenticationFilter.class)
                .authorizeHttpRequests(auth -> {
                    auth.dispatcherTypeMatchers(DispatcherType.ASYNC, DispatcherType.ERROR).permitAll();
                    auth.requestMatchers("/actuator/health/**", "/actuator/info").permitAll();
                    // The API key filter has already checked the key; each tool checks the user and the role.
                    auth.requestMatchers(mcpEndpoint).permitAll();
                    auth.anyRequest().denyAll();
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
}
