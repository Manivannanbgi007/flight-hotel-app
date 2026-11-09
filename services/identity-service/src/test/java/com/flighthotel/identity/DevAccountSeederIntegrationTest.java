package com.flighthotel.identity;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.flighthotel.common.crypto.FieldEncryptor;
import com.flighthotel.common.dev.DevIds;
import com.flighthotel.common.dev.DevScenario;
import com.flighthotel.common.dev.DevSeed;
import com.flighthotel.events.identity.UserRegistered;
import com.flighthotel.identity.config.DevAccountSeeder;

/**
 * The development accounts: created once with their deterministic ids, the documented password and their profile
 * data; never twice; never when the switch is off or the prod profile is active. The seeder is created by hand here
 * (the shared test context runs with the switch off) and its rows are removed again after each test.
 */
class DevAccountSeederIntegrationTest extends IdentityIntegrationTest {

    @Autowired
    ConfigurableApplicationContext context;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    FieldEncryptor encryptor;

    @BeforeEach
    @AfterEach
    void removeDevRows() {
        String ids = "(SELECT id FROM users WHERE email LIKE 'dev.%@flighthotel.local')";
        jdbcClient.sql("DELETE FROM login_history WHERE user_id IN " + ids).update();
        jdbcClient.sql("DELETE FROM customer_passengers WHERE user_id IN " + ids).update();
        jdbcClient.sql("DELETE FROM travel_preferences WHERE user_id IN " + ids).update();
        jdbcClient.sql("DELETE FROM user_roles WHERE user_id IN " + ids).update();
        jdbcClient.sql("DELETE FROM refresh_tokens WHERE user_id IN " + ids).update();
        jdbcClient.sql("DELETE FROM users WHERE email LIKE 'dev.%@flighthotel.local'").update();
    }

    private void seed() {
        context.getAutowireCapableBeanFactory().createBean(DevAccountSeeder.class).run(null);
    }

    private long registeredEvents() {
        return count("SELECT COUNT(*) FROM outbox_events WHERE event_type = '" + UserRegistered.class.getName() + "'");
    }

    private long count(String sql) {
        return jdbcClient.sql(sql).query(Long.class).single();
    }

    @Test
    void createsOneAccountPerRoleWithDeterministicIdsAndTheDocumentedPassword() throws Exception {
        long demoBefore = count("SELECT COUNT(*) FROM users WHERE email = 'customer@flighthotel.local'");
        long announced = registeredEvents();

        seed();

        assertThat(count("SELECT COUNT(*) FROM users WHERE email LIKE 'dev.%@flighthotel.local'"))
                .isEqualTo(DevScenario.PEOPLE.size());
        for (DevScenario.Person person : DevScenario.PEOPLE) {
            String hash = jdbcClient.sql("SELECT password_hash FROM users WHERE id = :id")
                    .param("id", DevIds.bytes(DevIds.user(person.email()))).query(String.class).single();
            assertThat(hash).startsWith("{bcrypt}");
            assertThat(passwordEncoder.matches(DevSeed.PASSWORD, hash)).isTrue();
            assertThat(jdbcClient.sql("""
                            SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = :id""")
                    .param("id", DevIds.bytes(person.id())).query(String.class).list()).containsExactly(person.role());
        }
        assertThat(count("SELECT COUNT(*) FROM users WHERE email = 'customer@flighthotel.local'")).isEqualTo(demoBefore);
        // The account is announced like any new account, so other services learn about it.
        assertThat(registeredEvents() - announced).isEqualTo(DevScenario.PEOPLE.size());
        // The accounts really sign in with it (customer page and hotel manager page).
        assertThat(login(DevScenario.CUSTOMER1.email(), DevSeed.PASSWORD).accessToken()).isNotBlank();
        assertThat(login(DevScenario.MANAGER2.email(), DevSeed.PASSWORD).accessToken()).isNotBlank();
    }

    @Test
    void savesPassengersPreferencesAndSignInHistoryForTheCustomers() {
        seed();

        List<String> names = jdbcClient.sql("""
                        SELECT first_name FROM customer_passengers WHERE user_id = :id ORDER BY first_name""")
                .param("id", DevIds.bytes(DevScenario.CUSTOMER1.id())).query(String.class).list();
        assertThat(names).containsExactly("Aarav", "Ananya", "Kabir");
        String stored = jdbcClient.sql("SELECT passport_number_enc FROM customer_passengers WHERE id = :id")
                .param("id", DevIds.bytes(DevScenario.traveller("c1-self").savedId())).query(String.class).single();
        assertThat(stored).startsWith("v1:");
        assertThat(encryptor.decrypt(stored)).isEqualTo("K1234567");
        assertThat(count("SELECT COUNT(*) FROM travel_preferences WHERE user_id IN (SELECT id FROM users WHERE "
                + "email LIKE 'dev.customer%')")).isEqualTo(2);
        assertThat(count("SELECT COUNT(*) FROM login_history WHERE user_id = "
                + "(SELECT id FROM users WHERE email = 'dev.customer1@flighthotel.local')")).isEqualTo(4);
    }

    @Test
    void aSecondRunCreatesNothingNew() {
        seed();
        long users = count("SELECT COUNT(*) FROM users");
        long passengers = count("SELECT COUNT(*) FROM customer_passengers");
        long history = count("SELECT COUNT(*) FROM login_history");
        long events = count("SELECT COUNT(*) FROM outbox_events");

        seed();

        assertThat(count("SELECT COUNT(*) FROM users")).isEqualTo(users);
        assertThat(count("SELECT COUNT(*) FROM customer_passengers")).isEqualTo(passengers);
        assertThat(count("SELECT COUNT(*) FROM login_history")).isEqualTo(history);
        assertThat(count("SELECT COUNT(*) FROM outbox_events")).isEqualTo(events);
    }

    @Test
    void nothingIsCreatedWhenTheSwitchIsOffOrTheProdProfileIsActive() {
        // Switch off (the shared context): the seeder is not even a bean.
        assertThat(context.getBeansOfType(DevAccountSeeder.class)).isEmpty();

        // Switch on in production: refused.
        ConfigurableEnvironment environment = context.getEnvironment();
        String[] profiles = environment.getActiveProfiles();
        environment.setActiveProfiles("prod");
        try {
            seed();
        } finally {
            environment.setActiveProfiles(profiles);
        }
        assertThat(count("SELECT COUNT(*) FROM users WHERE email LIKE 'dev.%@flighthotel.local'")).isZero();
    }
}
