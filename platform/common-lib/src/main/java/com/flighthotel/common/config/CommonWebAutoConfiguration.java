package com.flighthotel.common.config;

import java.nio.file.Path;
import java.time.Clock;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;

import com.flighthotel.common.correlation.CorrelationIdFilter;
import com.flighthotel.common.error.GlobalExceptionHandler;
import com.flighthotel.common.image.ImageProcessor;
import com.flighthotel.common.logging.ServiceLoggingAspect;
import com.flighthotel.common.storage.FileStorage;
import com.flighthotel.common.storage.LocalFileStorage;
import com.flighthotel.common.storage.S3FileStorage;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;

/** Web basics for every business service: correlation IDs, error format, service logging, OpenAPI, clock. */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@EnableConfigurationProperties(CommonProperties.class)
public class CommonWebAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    public FilterRegistrationBean<CorrelationIdFilter> correlationIdFilter() {
        FilterRegistrationBean<CorrelationIdFilter> registration = new FilterRegistrationBean<>(new CorrelationIdFilter());
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        registration.setAsyncSupported(true);
        return registration;
    }

    @Bean
    @ConditionalOnMissingBean
    public GlobalExceptionHandler globalExceptionHandler() {
        return new GlobalExceptionHandler();
    }

    /** {@code travel.storage.type}: local disk (development, Docker) or a private S3 bucket (production). */
    @Bean
    @ConditionalOnMissingBean
    public FileStorage fileStorage(CommonProperties properties) {
        CommonProperties.Storage storage = properties.storage();
        if (!"s3".equalsIgnoreCase(storage.type())) {
            return new LocalFileStorage(Path.of(storage.localRoot()));
        }
        CommonProperties.S3 s3 = storage.s3();
        if (s3.bucket() == null || s3.bucket().isBlank()) {
            throw new IllegalStateException("travel.storage.s3.bucket is required when travel.storage.type=s3");
        }
        return new S3FileStorage(S3Clients.create(s3), s3.bucket(), s3.prefix());
    }

    @Bean
    @ConditionalOnMissingBean
    public ImageProcessor imageProcessor() {
        return new ImageProcessor();
    }

    @Bean
    public ServiceLoggingAspect serviceLoggingAspect(CommonProperties properties) {
        return new ServiceLoggingAspect(properties.logging().slowServiceCall().toMillis());
    }

    @Bean
    @ConditionalOnMissingBean
    public OpenAPI serviceOpenApi(@Value("${spring.application.name}") String serviceName) {
        String scheme = "bearer-jwt";
        return new OpenAPI()
                .info(new Info().title(serviceName + " API").version("v1")
                        .description("Hotel & Flight Travel Reservation System — " + serviceName))
                .components(new Components().addSecuritySchemes(scheme, new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList(scheme));
    }
}
