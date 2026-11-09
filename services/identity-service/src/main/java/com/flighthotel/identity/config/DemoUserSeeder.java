package com.flighthotel.identity.config;

import java.time.Clock;
import java.util.List;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.flighthotel.common.security.Roles;
import com.flighthotel.identity.entity.Role;
import com.flighthotel.identity.entity.User;
import com.flighthotel.identity.entity.UserStatus;
import com.flighthotel.identity.messaging.IdentityEventPublisher;
import com.flighthotel.identity.repository.RoleRepository;
import com.flighthotel.identity.repository.UserRepository;
import com.flighthotel.identity.security.PasswordPolicy;

/**
 * <b>Local development only</b> ({@code identity.demo-users.enabled=true}, always off in the prod profile): creates
 * one active account per role so every portal can be tried without manual SQL. All use {@code DEMO_USER_PASSWORD}.
 * Existing accounts are never changed.
 */
@Component
@ConditionalOnProperty(prefix = "identity.demo-users", name = "enabled", havingValue = "true")
public class DemoUserSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoUserSeeder.class);

    static final List<DemoUser> DEMO_USERS = List.of(
            new DemoUser("admin@flighthotel.local", "Demo", "Admin", Roles.ADMIN),
            new DemoUser("customer@flighthotel.local", "Demo", "Customer", Roles.CUSTOMER),
            new DemoUser("manager@flighthotel.local", "Demo", "Manager", Roles.HOTEL_MANAGER),
            new DemoUser("support@flighthotel.local", "Demo", "Support", Roles.SUPPORT_AGENT));

    private final UserRepository users;
    private final RoleRepository roles;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy passwordPolicy;
    private final IdentityEventPublisher events;
    private final TransactionTemplate transactionTemplate;
    private final IdentityProperties properties;
    private final Clock clock;

    public DemoUserSeeder(UserRepository users, RoleRepository roles, PasswordEncoder passwordEncoder,
            PasswordPolicy passwordPolicy, IdentityEventPublisher events, TransactionTemplate transactionTemplate,
            IdentityProperties properties, Clock clock) {
        this.users = users;
        this.roles = roles;
        this.passwordEncoder = passwordEncoder;
        this.passwordPolicy = passwordPolicy;
        this.events = events;
        this.transactionTemplate = transactionTemplate;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        String password = properties.demoUsers().password();
        if (password == null || password.isBlank()) {
            log.warn("Demo users are enabled but DEMO_USER_PASSWORD is empty; no demo users created");
            return;
        }
        passwordPolicy.check(password, null);
        String hash = passwordEncoder.encode(password);
        transactionTemplate.executeWithoutResult(status -> DEMO_USERS.forEach(demo -> {
            if (users.existsByEmail(demo.email())) {
                return;
            }
            Role role = roles.findByName(demo.role()).orElseThrow();
            User user = new User(demo.email(), hash, demo.firstName(), demo.lastName(), null, UserStatus.ACTIVE,
                    Set.of(role), clock.instant());
            users.save(user);
            events.userRegistered(user);
            log.info("Created demo user email={} role={}", demo.email(), demo.role());
        }));
    }

    record DemoUser(String email, String firstName, String lastName, String role) {
    }
}
