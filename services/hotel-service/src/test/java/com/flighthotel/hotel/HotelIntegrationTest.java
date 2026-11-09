package com.flighthotel.hotel;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;

import java.time.LocalDate;
import java.time.Month;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.elasticsearch.ElasticsearchContainer;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;

import com.flighthotel.hotel.inventory.InventoryService;
import com.flighthotel.hotel.support.Uuids;

/**
 * Base for hotel-service integration tests: the real service against MySQL, Redis and Elasticsearch (Testcontainers,
 * started once). The labelled demo catalogue is seeded and indexed at startup, so tests search real data.
 * Kafka listeners are off and Schema Registry is mocked.
 */
@SpringBootTest(properties = {
        "spring.kafka.listener.auto-startup=false",
        "travel.kafka.schema-registry-url=mock://hotel-it",
        "travel.storage.local-root=target/test-storage",
        "hotel.demo-data.enabled=true"
})
@AutoConfigureMockMvc
public abstract class HotelIntegrationTest {

    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.4.13").withDatabaseName("hotel_db");
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:8.4.8")).withExposedPorts(6379);
    static final ElasticsearchContainer ELASTICSEARCH =
            new ElasticsearchContainer("docker.elastic.co/elasticsearch/elasticsearch:9.4.8")
                    .withEnv("xpack.security.enabled", "false")
                    .withEnv("ES_JAVA_OPTS", "-Xms512m -Xmx512m");

    static {
        MYSQL.start();
        REDIS.start();
        ELASTICSEARCH.start();
    }

    @DynamicPropertySource
    static void infrastructure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
        registry.add("spring.elasticsearch.uris", () -> "http://" + ELASTICSEARCH.getHttpHostAddress());
    }

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected JdbcClient jdbcClient;

    @Autowired
    protected InventoryService inventory;

    // ------------------------------------------------------------------ users (JWTs as the gateway would pass them)

    protected static JwtRequestPostProcessor customer() {
        return user(UUID.randomUUID(), Set.of("CUSTOMER"), Set.of());
    }

    protected static JwtRequestPostProcessor admin() {
        return user(UUID.randomUUID(), Set.of("ADMIN"), Set.of("HOTEL_MANAGE_ANY", "USER_MANAGE"));
    }

    protected static JwtRequestPostProcessor manager(UUID userId) {
        return user(userId, Set.of("HOTEL_MANAGER"), Set.of("HOTEL_MANAGE_ASSIGNED"));
    }

    protected static JwtRequestPostProcessor user(UUID userId, Set<String> roles, Set<String> permissions) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        roles.forEach(role -> authorities.add(new SimpleGrantedAuthority("ROLE_" + role)));
        permissions.forEach(permission -> authorities.add(new SimpleGrantedAuthority(permission)));
        return jwt().jwt(token -> token.subject(userId.toString())
                        .claim("roles", List.copyOf(roles))
                        .claim("permissions", List.copyOf(permissions)))
                .authorities(authorities);
    }

    // ------------------------------------------------------------------ data helpers

    protected UUID hotelId(String name) {
        return jdbcClient.sql("SELECT id FROM hotels WHERE name = :name")
                .param("name", name)
                .query((rs, i) -> Uuids.fromBytes(rs.getBytes("id"))).single();
    }

    protected UUID roomTypeId(String hotelName, String roomName) {
        return jdbcClient.sql("""
                        SELECT r.id FROM room_types r JOIN hotels h ON h.id = r.hotel_id
                        WHERE h.name = :hotel AND r.name = :room""")
                .param("hotel", hotelName)
                .param("room", roomName)
                .query((rs, i) -> Uuids.fromBytes(rs.getBytes("id"))).single();
    }

    /**
     * A check-in date outside the demo "year-end peak" (20 Dec - 4 Jan), so base prices apply, at least
     * {@code daysAhead} days from today.
     */
    protected LocalDate offPeak(int daysAhead) {
        LocalDate date = inventory.today().plusDays(daysAhead);
        while ((date.getMonth() == Month.DECEMBER && date.getDayOfMonth() >= 10)
                || (date.getMonth() == Month.JANUARY && date.getDayOfMonth() <= 10)) {
            date = date.plusDays(7);
        }
        return date;
    }
}
