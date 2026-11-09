package com.flighthotel.mcpserver.security;

import java.util.Collection;
import java.util.Optional;
import java.util.Set;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;

import io.modelcontextprotocol.common.McpTransportContext;

/**
 * The signed-in user behind one MCP request: taken from the access token that Spring Security has already validated
 * (signature via JWKS, issuer, expiry, revocation). The raw token is kept only to call the gateway on the user's
 * behalf; it is never logged and never returned.
 */
public record Caller(AuthenticatedUser user, String accessToken) {

    /** Key in the {@link McpTransportContext}. */
    public static final String CONTEXT_KEY = "caller";

    public Set<String> roles() {
        return user.roles();
    }

    public boolean hasAnyRole(Collection<String> wanted) {
        return wanted.stream().anyMatch(user.roles()::contains);
    }

    /** The caller of the current HTTP request (servlet thread, after the security filters). */
    public static Optional<Caller> fromSecurityContext() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken jwt && jwt.isAuthenticated()) {
            return Optional.of(new Caller(CurrentUser.fromJwt(jwt.getToken()), jwt.getToken().getTokenValue()));
        }
        return Optional.empty();
    }

    public static Optional<Caller> from(McpTransportContext context) {
        return context != null && context.get(CONTEXT_KEY) instanceof Caller caller ? Optional.of(caller)
                : Optional.empty();
    }

    @Override
    public String toString() {
        // Never print the token (records print every component by default).
        return "Caller[user=" + user.id() + ", roles=" + user.roles() + "]";
    }
}
