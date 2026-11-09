package com.flighthotel.search.sync;

import static com.flighthotel.search.index.SearchCategory.USERS;

import java.time.Instant;
import java.util.List;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.listener.AbstractConsumerSeekAware;
import org.springframework.stereotype.Component;

import com.flighthotel.events.identity.UserProfileUpdated;
import com.flighthotel.events.identity.UserRegistered;
import com.flighthotel.events.identity.UserRolesChanged;
import com.flighthotel.events.identity.UserSnapshot;
import com.flighthotel.events.identity.UserStatusChanged;
import com.flighthotel.search.index.Fields;
import com.flighthotel.search.index.IndexWriter;
import com.flighthotel.search.index.IndexWriter.Merge;
import com.flighthotel.search.support.Format;

/**
 * identity.events → user documents (category USERS): name, e-mail, roles and status. Only staff with USER_READ_ANY
 * can find them (see {@code AccessRules}).
 */
@Component
public class IdentityEventsListener extends AbstractConsumerSeekAware {

    /** Every field a full user state writes. */
    static final List<String> USER_FIELDS = List.of("category", "entityId", "title", "subtitle", "keywords",
            "identifiers", "roles", "status", "createdAt");

    private final IndexWriter writer;

    public IdentityEventsListener(IndexWriter writer) {
        this.writer = writer;
    }

    @KafkaListener(id = "search-identity", groupId = "search-identity", topics = "identity.events")
    public void onEvent(ConsumerRecord<String, Object> record) {
        handle(record.value());
    }

    /** Also called directly by tests. */
    public void handle(Object event) {
        switch (event) {
            case UserSnapshot e -> writer.replaceState(USERS, e.getUserId(), e.getSnapshotAt(),
                    user(e.getUserId(), e.getEmail(), e.getFirstName(), e.getLastName(), e.getRoles(), e.getStatus(),
                            e.getRegisteredAt()),
                    USER_FIELDS);
            case UserRegistered e -> writer.replaceState(USERS, e.getUserId(), e.getRegisteredAt(),
                    user(e.getUserId(), e.getEmail(), e.getFirstName(), e.getLastName(), e.getRoles(), e.getStatus(),
                            e.getRegisteredAt()),
                    USER_FIELDS);
            case UserProfileUpdated e -> writer.merge(USERS, e.getUserId(), Merge.of(Fields.partial()
                    .put("title", fullName(e.getFirstName(), e.getLastName(), e.getEmail()))
                    .put("subtitle", e.getEmail())
                    .add("keywords", e.getFirstName(), e.getLastName())
                    .add("identifiers", e.getEmail(), e.getUserId()))
                    .at(e.getUpdatedAt()));
            case UserRolesChanged e -> writer.merge(USERS, e.getUserId(),
                    Merge.of(Fields.partial().put("roles", e.getRoles())).at(e.getChangedAt()));
            case UserStatusChanged e -> writer.merge(USERS, e.getUserId(),
                    Merge.of(Fields.partial().put("status", e.getStatus())).at(e.getChangedAt()));
            default -> {
                // Other identity events (e-mail verified, password e-mails) change nothing that is searched.
            }
        }
    }

    private static Fields user(String userId, String email, String firstName, String lastName, List<String> roles,
            String status, Instant registeredAt) {
        return Fields.of(USERS, userId)
                .put("title", fullName(firstName, lastName, email))
                .put("subtitle", email)
                .add("keywords", firstName, lastName)
                .add("identifiers", email, userId)
                .put("roles", roles)
                .put("status", status)
                .put("createdAt", registeredAt);
    }

    private static String fullName(String firstName, String lastName, String email) {
        String name = ((firstName == null ? "" : firstName) + " " + (lastName == null ? "" : lastName)).strip();
        return Format.firstNonBlank(name, email);
    }
}
