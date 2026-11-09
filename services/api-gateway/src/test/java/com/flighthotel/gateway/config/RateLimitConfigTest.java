package com.flighthotel.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;

class RateLimitConfigTest {

    /** Same default as application.yml. */
    private static final Pattern TRUSTED = Pattern.compile(
            "127\\.0\\.0\\.1|0:0:0:0:0:0:0:1|::1|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}"
                    + "|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}");

    @Test
    void behindTrustedProxyTheBrowserIpIsUsed() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/api/auth/login")
                .remoteAddress(new InetSocketAddress("172.18.0.10", 40000))
                .header("X-Forwarded-For", "203.0.113.7")
                .build();

        assertThat(RateLimitConfig.clientIp(request, TRUSTED)).isEqualTo("203.0.113.7");
    }

    @Test
    void anUntrustedPeerCannotPickItsOwnIp() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/api/auth/login")
                .remoteAddress(new InetSocketAddress("198.51.100.20", 40000))
                .header("X-Forwarded-For", "1.2.3.4")
                .build();

        assertThat(RateLimitConfig.clientIp(request, TRUSTED)).isEqualTo("198.51.100.20");
    }

    @Test
    void fallsBackToThePeerWithoutHeaderOrConfiguration() {
        MockServerHttpRequest noHeader = MockServerHttpRequest.get("/")
                .remoteAddress(new InetSocketAddress("10.0.0.5", 40000)).build();
        MockServerHttpRequest notConfigured = MockServerHttpRequest.get("/")
                .remoteAddress(new InetSocketAddress("10.0.0.5", 40000))
                .header("X-Forwarded-For", "203.0.113.7").build();

        assertThat(RateLimitConfig.clientIp(noHeader, TRUSTED)).isEqualTo("10.0.0.5");
        assertThat(RateLimitConfig.clientIp(notConfigured, null)).isEqualTo("10.0.0.5");
    }

    @Test
    void usesTheFirstAddressOfAChain() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/")
                .remoteAddress(new InetSocketAddress("127.0.0.1", 40000))
                .header("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
                .build();

        assertThat(RateLimitConfig.clientIp(request, TRUSTED)).isEqualTo("203.0.113.7");
    }
}
