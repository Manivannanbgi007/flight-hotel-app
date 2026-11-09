package com.flighthotel.identity.config;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.env.Environment;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.common.crypto.FieldEncryptor;
import com.flighthotel.common.dev.DevIds;
import com.flighthotel.common.dev.DevScenario;
import com.flighthotel.common.dev.DevScenario.Person;
import com.flighthotel.common.dev.DevScenario.Traveller;
import com.flighthotel.common.dev.DevSeed;
import com.flighthotel.common.persistence.SecurityAuditorAware;
import com.flighthotel.identity.messaging.IdentityEventPublisher;
import com.flighthotel.identity.repository.UserRepository;
import com.flighthotel.identity.security.PasswordPolicy;

/**
 * <b>Development only</b> ({@code identity.dev-seed.enabled=true}, environment variable {@code DEV_SEED_ENABLED};
 * refuses to run in the {@code prod} profile): creates the development accounts of
 * {@code docs/DEVELOPMENT_TEST_ACCOUNTS.md}, one or two per role, all with the documented development password,
 * and their profile data (saved passengers with passports, travel preferences, sign-in history).
 * <p>
 * The user ids are deterministic ({@link DevIds#user}), so the other services' dev seeders can refer to the
 * accounts without asking identity-service. The accounts are announced like any new account ({@code UserRegistered}
 * through the outbox). Accounts that already exist are never changed; a second run adds nothing.
 */
@Component
@Order(20)
@ConditionalOnProperty(prefix = "identity.dev-seed", name = "enabled", havingValue = "true")
public class DevAccountSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevAccountSeeder.class);

    private final JdbcClient jdbc;
    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy passwordPolicy;
    private final IdentityEventPublisher events;
    private final FieldEncryptor encryptor;
    private final TransactionTemplate transactions;
    private final Environment environment;
    private final Clock clock;

    public DevAccountSeeder(JdbcClient jdbc, UserRepository users, PasswordEncoder passwordEncoder,
            PasswordPolicy passwordPolicy, IdentityEventPublisher events, FieldEncryptor encryptor,
            TransactionTemplate transactions, Environment environment, Clock clock) {
        this.jdbc = jdbc;
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.passwordPolicy = passwordPolicy;
        this.events = events;
        this.encryptor = encryptor;
        this.transactions = transactions;
        this.environment = environment;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!DevSeed.allowed(environment, log, "identity-service")) {
            return;
        }
        passwordPolicy.check(DevSeed.PASSWORD, null);
        String hash = passwordEncoder.encode(DevSeed.PASSWORD);
        int created = 0;
        for (Person person : DevScenario.PEOPLE) {
            Boolean added = transactions.execute(status -> seedPerson(person, hash));
            if (Boolean.TRUE.equals(added)) {
                created++;
            }
        }
        transactions.executeWithoutResult(status -> DevScenario.TRAVELLERS.forEach(this::seedPassenger));
        log.info("Development accounts ready: {} created, {} in total (password is documented in "
                + "docs/DEVELOPMENT_TEST_ACCOUNTS.md)", created, DevScenario.PEOPLE.size());
    }

    private boolean seedPerson(Person person, String hash) {
        if (users.existsByEmail(person.email())) {
            return false;
        }
        Instant now = clock.instant();
        Instant created = now.minus(120, ChronoUnit.DAYS);
        UUID id = person.id();
        jdbc.sql("""
                        INSERT INTO users (id, email, password_hash, first_name, last_name, phone, date_of_birth,
                          nationality, status, email_verified_at, failed_login_count, last_login_at, password_changed_at,
                          created_at, updated_at, created_by, updated_by, version)
                        VALUES (:id, :email, :hash, :first, :last, :phone, :dob, 'IN', 'ACTIVE', :created, 0, :lastLogin,
                          :created, :created, :created, :by, :by, 0)""")
                .param("id", DevIds.bytes(id))
                .param("email", person.email())
                .param("hash", hash)
                .param("first", person.firstName())
                .param("last", person.lastName())
                .param("phone", person.phone())
                .param("dob", java.sql.Date.valueOf(person.dateOfBirth()))
                .param("created", Timestamp.from(created))
                .param("lastLogin", Timestamp.from(now.minus(1, ChronoUnit.DAYS)))
                .param("by", SecurityAuditorAware.SYSTEM)
                .update();
        jdbc.sql("INSERT INTO user_roles (user_id, role_id) SELECT :id, id FROM roles WHERE name = :role")
                .param("id", DevIds.bytes(id)).param("role", person.role()).update();
        if (person.role().equals("CUSTOMER")) {
            preferences(person, now);
        }
        loginHistory(person, now);
        // Same announcement as any new account: other services keep their own copy (hotel managers' names, reports).
        users.findById(id).ifPresent(events::userRegistered);
        log.info("Created development account email={} role={}", person.email(), person.role());
        return true;
    }

    private void preferences(Person person, Instant now) {
        boolean first = person.key().equals("customer1");
        jdbc.sql("""
                        INSERT IGNORE INTO travel_preferences (user_id, preferred_cabin, home_airport, seat_preference,
                          meal_preference, preferred_currency, newsletter_opt_in, created_at, updated_at, created_by,
                          updated_by, version)
                        VALUES (:id, :cabin, :home, :seat, :meal, 'INR', :newsletter, :now, :now, :by, :by, 0)""")
                .param("id", DevIds.bytes(person.id()))
                .param("cabin", first ? "ECONOMY" : "PREMIUM_ECONOMY")
                .param("home", first ? "DEL" : "BLR")
                .param("seat", first ? "WINDOW" : "AISLE")
                .param("meal", first ? "VEGETARIAN" : "NO_PREFERENCE")
                .param("newsletter", first)
                .param("now", Timestamp.from(now))
                .param("by", SecurityAuditorAware.SYSTEM)
                .update();
    }

    /** A few past sign-ins (documentation address range 203.0.113.0/24), one of them a wrong password. */
    private void loginHistory(Person person, Instant now) {
        for (int i = 0; i < 4; i++) {
            boolean failed = i == 2 && person.role().equals("CUSTOMER");
            jdbc.sql("""
                            INSERT IGNORE INTO login_history (id, user_id, success, failure_reason, ip_address, user_agent,
                              occurred_at)
                            VALUES (:id, :user, :success, :reason, :ip, :agent, :at)""")
                    .param("id", DevIds.bytes(DevIds.of("login", person.email() + ":" + i)))
                    .param("user", DevIds.bytes(person.id()))
                    .param("success", !failed)
                    .param("reason", failed ? "BAD_PASSWORD" : null)
                    .param("ip", "203.0.113." + (10 + i))
                    .param("agent", i % 2 == 0 ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0"
                            : "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1")
                    .param("at", Timestamp.from(now.minus(1 + i * 6L, ChronoUnit.DAYS)))
                    .update();
        }
    }

    private void seedPassenger(Traveller traveller) {
        Person owner = DevScenario.person(traveller.owner());
        boolean ownerExists = jdbc.sql("SELECT COUNT(*) FROM users WHERE id = :id")
                .param("id", DevIds.bytes(owner.id())).query(Long.class).single() > 0;
        if (!ownerExists) {
            return;
        }
        Instant now = clock.instant();
        String passport = traveller.passportNumber();
        jdbc.sql("""
                        INSERT IGNORE INTO customer_passengers (id, user_id, passenger_type, first_name, last_name,
                          date_of_birth, gender, nationality, passport_number_enc, passport_last4, passport_expiry,
                          passport_country, created_at, updated_at, created_by, updated_by, version)
                        VALUES (:id, :user, :type, :first, :last, :dob, :gender, 'IN', :enc, :last4, :expiry, :country,
                          :now, :now, :by, :by, 0)""")
                .param("id", DevIds.bytes(traveller.savedId()))
                .param("user", DevIds.bytes(owner.id()))
                .param("type", traveller.type())
                .param("first", traveller.firstName())
                .param("last", traveller.lastName())
                .param("dob", java.sql.Date.valueOf(traveller.dateOfBirth()))
                .param("gender", traveller.gender())
                .param("enc", passport == null ? null : encryptor.encrypt(passport))
                .param("last4", passport == null ? null : passport.substring(passport.length() - 4))
                .param("expiry", passport == null ? null : java.sql.Date.valueOf(traveller.passportExpiry()))
                .param("country", passport == null ? null : "IN")
                .param("now", Timestamp.from(now.minus(90, ChronoUnit.DAYS)))
                .param("by", SecurityAuditorAware.SYSTEM)
                .update();
    }
}
