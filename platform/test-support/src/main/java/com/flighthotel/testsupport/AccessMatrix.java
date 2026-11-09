package com.flighthotel.testsupport;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Supplier;

import org.assertj.core.api.SoftAssertions;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;

import com.flighthotel.testsupport.Endpoints.Endpoint;

/**
 * The security rules of a service, endpoint by endpoint:
 * <ul>
 * <li>{@link #everyEndpointNeedsALoginExcept}: a caller without a token is refused everywhere except on the public
 * endpoints, which the test writes out (they are not read from the configuration, so making an endpoint public is a
 * visible change);</li>
 * <li>{@link #refuse}: roles without the permission get {@code 403 FORBIDDEN}. Each request must be one the
 * endpoint would otherwise accept (a valid body, the required parameters): request validation runs before the
 * permission check, so an invalid request would only prove a {@code 400}. {@link #assertCovers} makes sure no
 * staff endpoint is left out.</li>
 * <li>{@link #allow}: roles that must get a {@code 2xx} for this valid request (endpoints every signed-in role may
 * call, each for its own data), checked by {@link #assertAllowed}.</li>
 * </ul>
 */
public final class AccessMatrix {

    /** Any request builder: plain requests and multipart uploads. */
    private record Check(String endpoint, Supplier<? extends AbstractMockHttpServletRequestBuilder<?>> request,
            List<String> roles, boolean allowed) {
    }

    private final List<Check> checks = new ArrayList<>();

    /** Without a token every endpoint answers 401 (from the security filter), except the public ones. */
    public static void everyEndpointNeedsALoginExcept(MockMvc mockMvc, List<Endpoint> endpoints,
            Set<String> publicEndpoints) throws Exception {
        assertThat(endpoints).as("the service's endpoints").isNotEmpty();
        assertThat(endpoints.stream().map(Endpoint::key).toList()).as("public endpoints that exist")
                .containsAll(publicEndpoints);
        SoftAssertions softly = new SoftAssertions();
        for (Endpoint endpoint : endpoints) {
            MockHttpServletResponse response = mockMvc.perform(endpoint.request()).andReturn().getResponse();
            // The security layer's refusal: 401 with the Bearer challenge (a business 401 has no challenge).
            boolean loginRequired = response.getStatus() == 401
                    && "Bearer".equals(response.getHeader("WWW-Authenticate"));
            if (publicEndpoints.contains(endpoint.key())) {
                softly.assertThat(loginRequired).as("%s is public and must not ask for a login", endpoint).isFalse();
            } else {
                softly.assertThat(loginRequired).as("%s must refuse a caller without a token, but answered %d",
                        endpoint, response.getStatus()).isTrue();
            }
        }
        softly.assertAll();
    }

    /** These roles must get 403 FORBIDDEN for this otherwise valid request ({@code endpoint}: "POST /api/x/{id}"). */
    public AccessMatrix refuse(String endpoint, Supplier<? extends AbstractMockHttpServletRequestBuilder<?>> request,
            String... roles) {
        checks.add(new Check(endpoint, request, List.of(roles), false));
        return this;
    }

    /** These roles must get a 2xx answer for this valid request ({@code endpoint}: "GET /api/x/summary"). */
    public AccessMatrix allow(String endpoint, Supplier<? extends AbstractMockHttpServletRequestBuilder<?>> request,
            String... roles) {
        checks.add(new Check(endpoint, request, List.of(roles), true));
        return this;
    }

    /** Every endpoint under the prefixes has a check, and every check is for an endpoint that exists. */
    public void assertCovers(List<Endpoint> endpoints, String... prefixes) {
        Set<String> expected = new TreeSet<>();
        endpoints.stream().filter(endpoint -> endpoint.isUnder(prefixes)).map(Endpoint::key).forEach(expected::add);
        Set<String> checked = new TreeSet<>();
        checks.forEach(check -> checked.add(check.endpoint()));
        assertThat(checked).as("staff endpoints without a permission check in this test").containsAll(expected);
        assertThat(endpoints.stream().map(Endpoint::key).toList()).as("checked endpoints that exist")
                .containsAll(checked);
    }

    public void assertRefused(MockMvc mockMvc) throws Exception {
        SoftAssertions softly = new SoftAssertions();
        for (Check check : checks.stream().filter(check -> !check.allowed()).toList()) {
            for (String role : check.roles()) {
                MockHttpServletResponse response = mockMvc.perform(check.request().get().with(RoleTokens.as(role)))
                        .andReturn().getResponse();
                softly.assertThat(response.getStatus()).as("%s as %s: %s", check.endpoint(), role,
                        response.getContentAsString()).isEqualTo(403);
                softly.assertThat(response.getContentAsString()).as("%s as %s", check.endpoint(), role)
                        .contains("\"code\":\"FORBIDDEN\"");
            }
        }
        softly.assertAll();
    }

    /** Runs the {@link #allow} checks: each role gets a 2xx answer. */
    public void assertAllowed(MockMvc mockMvc) throws Exception {
        SoftAssertions softly = new SoftAssertions();
        for (Check check : checks.stream().filter(Check::allowed).toList()) {
            for (String role : check.roles()) {
                MockHttpServletResponse response = mockMvc.perform(check.request().get().with(RoleTokens.as(role)))
                        .andReturn().getResponse();
                softly.assertThat(response.getStatus()).as("%s as %s: %s", check.endpoint(), role,
                        response.getContentAsString()).isBetween(200, 299);
            }
        }
        softly.assertAll();
    }
}
