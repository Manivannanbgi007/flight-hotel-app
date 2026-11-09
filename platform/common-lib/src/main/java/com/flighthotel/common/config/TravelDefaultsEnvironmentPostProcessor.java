package com.flighthotel.common.config;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Arrays;
import java.util.List;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;

/**
 * Loads {@code travel-defaults.yml} from common-lib with the <b>lowest</b> precedence.
 * <p>
 * So: environment variables &gt; the service's own {@code application.yml} &gt; these shared defaults.
 * (A plain {@code spring.config.import} would do the opposite and let defaults override service settings.)
 * Documents with {@code spring.config.activate.on-profile} are only applied when one of those profiles is active.
 */
public class TravelDefaultsEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    static final String RESOURCE = "travel-defaults.yml";
    private static final String NAME_PREFIX = "travelDefaults";
    private static final String ON_PROFILE = "spring.config.activate.on-profile";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Resource resource = new ClassPathResource(RESOURCE);
        if (!resource.exists()) {
            return;
        }
        List<PropertySource<?>> documents = load(resource);
        if (documents.isEmpty()) {
            return;
        }
        MutablePropertySources sources = environment.getPropertySources();
        // First document = base defaults, at the very end.
        PropertySource<?> base = documents.getFirst();
        sources.addLast(base);
        // Later documents are profile-specific: they beat the base defaults but nothing else.
        String higher = base.getName();
        for (PropertySource<?> document : documents.subList(1, documents.size())) {
            if (isActive(document, environment)) {
                sources.addBefore(higher, document);
                higher = document.getName();
            }
        }
    }

    private static boolean isActive(PropertySource<?> document, ConfigurableEnvironment environment) {
        Object onProfile = document.getProperty(ON_PROFILE);
        if (onProfile == null) {
            return true;
        }
        List<String> active = Arrays.asList(environment.getActiveProfiles());
        return Arrays.stream(onProfile.toString().split(","))
                .map(String::trim)
                .anyMatch(active::contains);
    }

    private static List<PropertySource<?>> load(Resource resource) {
        try {
            return new YamlPropertySourceLoader().load(NAME_PREFIX, resource);
        } catch (IOException ex) {
            throw new UncheckedIOException("Cannot read " + RESOURCE, ex);
        }
    }

    @Override
    public int getOrder() {
        // After Spring Boot has processed application.yml and activated profiles.
        return Ordered.LOWEST_PRECEDENCE;
    }
}
