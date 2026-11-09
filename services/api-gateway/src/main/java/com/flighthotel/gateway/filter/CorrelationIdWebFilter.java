package com.flighthotel.gateway.filter;

import java.util.UUID;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;

import reactor.core.publisher.Mono;

/**
 * Creates the correlation ID for every request (or keeps a safe one sent by the client), forwards it to the
 * service in {@code X-Correlation-Id}, returns it to the client and writes one access-log line per request.
 * <p>
 * It is a {@link WebFilter} with the highest precedence (not a gateway GlobalFilter), so it also runs for requests
 * that Spring Security rejects (401/403) and that therefore never reach a route.
 */
@Component
public class CorrelationIdWebFilter implements WebFilter, Ordered {

    public static final String HEADER = "X-Correlation-Id";
    private static final Pattern SAFE_VALUE = Pattern.compile("^[A-Za-z0-9._-]{8,64}$");
    private static final Logger accessLog = LoggerFactory.getLogger("gateway.access");

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String incoming = exchange.getRequest().getHeaders().getFirst(HEADER);
        String correlationId = incoming != null && SAFE_VALUE.matcher(incoming).matches()
                ? incoming : UUID.randomUUID().toString();

        ServerHttpRequest request = exchange.getRequest().mutate()
                .headers(headers -> headers.set(HEADER, correlationId))
                .build();
        exchange.getResponse().getHeaders().set(HEADER, correlationId);

        long start = System.nanoTime();
        return chain.filter(exchange.mutate().request(request).build())
                .doFinally(signal -> accessLog.info("method={} path={} status={} durationMs={} correlationId={}",
                        request.getMethod(), request.getPath().value(),
                        exchange.getResponse().getStatusCode() == null ? 0 : exchange.getResponse().getStatusCode().value(),
                        (System.nanoTime() - start) / 1_000_000, correlationId));
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
