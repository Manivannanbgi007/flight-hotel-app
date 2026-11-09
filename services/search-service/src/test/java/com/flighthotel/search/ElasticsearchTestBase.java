package com.flighthotel.search;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.elasticsearch.ElasticsearchContainer;

/**
 * One real Elasticsearch (the version of docker-compose.yml) for all integration tests of this service. Kafka is not
 * started: tests call the listeners' {@code handle(event)} directly, exactly what the Kafka listener does.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://search-it",
        "search.jobs.enabled=false",
        "search.flight-service-url=http://127.0.0.1:9",
        "search.hotel-service-url=http://127.0.0.1:9"
})
@AutoConfigureMockMvc
public abstract class ElasticsearchTestBase {

    static final ElasticsearchContainer ELASTICSEARCH =
            new ElasticsearchContainer("docker.elastic.co/elasticsearch/elasticsearch:9.4.8")
                    .withEnv("xpack.security.enabled", "false")
                    .withEnv("ES_JAVA_OPTS", "-Xms512m -Xmx512m");

    static {
        ELASTICSEARCH.start();
    }

    @DynamicPropertySource
    static void elasticsearch(DynamicPropertyRegistry registry) {
        registry.add("spring.elasticsearch.uris", () -> "http://" + ELASTICSEARCH.getHttpHostAddress());
    }
}
