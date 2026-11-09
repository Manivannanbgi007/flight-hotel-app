package com.flighthotel.common.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;

class PublicPathParsingTest {

    @Test
    void parsesOptionalMethodPrefix() {
        List<CommonSecurityAutoConfiguration.PublicPath> paths = CommonSecurityAutoConfiguration.parse(
                List.of("GET /api/hotels/**", "/api/auth/**", "  post   /api/payments/webhook ", ""));

        assertThat(paths).containsExactly(
                new CommonSecurityAutoConfiguration.PublicPath(HttpMethod.GET, "/api/hotels/**"),
                new CommonSecurityAutoConfiguration.PublicPath(null, "/api/auth/**"),
                new CommonSecurityAutoConfiguration.PublicPath(HttpMethod.POST, "/api/payments/webhook"));
    }
}
