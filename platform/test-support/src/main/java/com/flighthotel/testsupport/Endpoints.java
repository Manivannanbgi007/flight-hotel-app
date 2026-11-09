package com.flighthotel.testsupport;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * The endpoints of a service, read from its own controllers (package {@code com.flighthotel}) the way Spring MVC
 * registered them. Library endpoints (API docs, the error page, actuator) are not included.
 */
public final class Endpoints {

    private static final List<HttpMethod> ANY_METHOD = List.of(HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT,
            HttpMethod.PATCH, HttpMethod.DELETE);
    private static final Pattern VARIABLE = Pattern.compile("\\{\\*?([^}:]+)(?::[^}]*)?}");

    private Endpoints() {
    }

    /** One method on one path pattern, e.g. {@code POST /api/admin/coupons/{id}/status}. */
    public record Endpoint(HttpMethod method, String pattern) {

        public String key() {
            return method.name() + " " + pattern;
        }

        public boolean isUnder(String... prefixes) {
            for (String prefix : prefixes) {
                if (pattern.startsWith(prefix)) {
                    return true;
                }
            }
            return false;
        }

        /** A request to this endpoint; every path variable is a fresh random UUID. */
        public MockHttpServletRequestBuilder request() {
            return request(Map.of());
        }

        /** A request to this endpoint; path variables from {@code variables}, the others a fresh random UUID. */
        public MockHttpServletRequestBuilder request(Map<String, String> variables) {
            Matcher matcher = VARIABLE.matcher(pattern);
            StringBuilder uri = new StringBuilder();
            while (matcher.find()) {
                String value = variables.getOrDefault(matcher.group(1), UUID.randomUUID().toString());
                matcher.appendReplacement(uri, Matcher.quoteReplacement(value));
            }
            matcher.appendTail(uri);
            return MockMvcRequestBuilders.request(method, uri.toString());
        }

        @Override
        public String toString() {
            return key();
        }
    }

    /** Every endpoint of the service's own controllers, sorted by path and method. */
    public static List<Endpoint> of(ApplicationContext context) {
        Set<Endpoint> endpoints = new TreeSet<>(Comparator.comparing(Endpoint::pattern)
                .thenComparing(endpoint -> endpoint.method().name()));
        for (RequestMappingHandlerMapping mapping : context.getBeansOfType(RequestMappingHandlerMapping.class)
                .values()) {
            mapping.getHandlerMethods().forEach((info, handler) -> {
                if (!handler.getBeanType().getPackageName().startsWith("com.flighthotel.")) {
                    return;
                }
                Set<RequestMethod> methods = info.getMethodsCondition().getMethods();
                List<HttpMethod> httpMethods = methods.isEmpty() ? ANY_METHOD
                        : methods.stream().map(method -> HttpMethod.valueOf(method.name())).toList();
                for (String pattern : info.getPatternValues()) {
                    httpMethods.forEach(method -> endpoints.add(new Endpoint(method, pattern)));
                }
            });
        }
        return List.copyOf(endpoints);
    }
}
