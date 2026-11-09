package com.flighthotel.gateway.config;

import java.net.InetSocketAddress;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.cloud.gateway.route.Route;
import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.security.core.Authentication;

import reactor.core.publisher.Mono;

/**
 * Rate limits are counted per logged-in user, or per client IP for anonymous calls.
 * Limits are set in application.yml (RequestRateLimiter filters, backed by Redis).
 * If Redis is unavailable the limiter lets requests through rather than blocking the whole site.
 *
 * <p>Every route has its own bucket per user or IP: the Redis key includes the route id. A route with a limit of its
 * own (login, realtime, assistant) marks it with {@value #OWN_LIMIT} in its metadata, and there the default limit steps
 * aside ({@link #defaultLimitKeyResolver}). Why: Spring Cloud Gateway runs default filters on every route and keeps the
 * limiter's settings per route id, so such a route used to run two limiters, both with the route's settings, on the
 * same bucket. Every request was charged twice (a login burst of 5 instead of 10, one assistant question instead of 3).
 */
@Configuration
public class RateLimitConfig {

    /** Route metadata flag: this route has its own RequestRateLimiter; the default limit does not apply. */
    public static final String OWN_LIMIT = "own-rate-limit";

    @Bean
    @Primary
    KeyResolver userOrIpKeyResolver(@Value("${spring.cloud.gateway.server.webflux.trusted-proxies:}") String trustedProxies) {
        Pattern trusted = trustedProxies.isBlank() ? null : Pattern.compile(trustedProxies);
        return exchange -> exchange.getPrincipal()
                .filter(Authentication.class::isInstance)
                .map(principal -> "user:" + principal.getName())
                .switchIfEmpty(Mono.fromSupplier(() -> "ip:" + clientIp(exchange.getRequest(), trusted)));
    }

    /**
     * The default limit's key: the user or IP, or no key on a route with its own limit. The filter treats "no key" as
     * its empty key and, with {@code deny-empty-key: false}, lets the request through to the route's own limiter.
     */
    @Bean
    KeyResolver defaultLimitKeyResolver(KeyResolver userOrIpKeyResolver) {
        return exchange -> hasOwnLimit(exchange.getAttribute(ServerWebExchangeUtils.GATEWAY_ROUTE_ATTR))
                ? Mono.empty()
                : userOrIpKeyResolver.resolve(exchange);
    }

    static boolean hasOwnLimit(Route route) {
        return route != null && Boolean.parseBoolean(String.valueOf(route.getMetadata().get(OWN_LIMIT)));
    }

    /**
     * The browser's IP. Behind nginx (the edge proxy, which overwrites X-Forwarded-For with the real peer) every
     * request comes from nginx, so without this all anonymous visitors would share ONE rate-limit bucket.
     * The header is only believed when the direct peer is a trusted proxy; anyone else could put any IP in it.
     */
    static String clientIp(ServerHttpRequest request, Pattern trustedProxies) {
        InetSocketAddress remote = request.getRemoteAddress();
        String peer = remote == null || remote.getAddress() == null ? "unknown" : remote.getAddress().getHostAddress();
        if (trustedProxies == null || !trustedProxies.matcher(peer).matches()) {
            return peer;
        }
        String forwardedFor = request.getHeaders().getFirst("X-Forwarded-For");
        if (forwardedFor == null || forwardedFor.isBlank()) {
            return peer;
        }
        String client = forwardedFor.split(",")[0].trim();
        return client.isEmpty() ? peer : client;
    }
}
