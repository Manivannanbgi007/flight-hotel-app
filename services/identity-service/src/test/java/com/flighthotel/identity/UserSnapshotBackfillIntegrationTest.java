package com.flighthotel.identity;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import com.flighthotel.events.identity.UserSnapshot;
import com.flighthotel.identity.messaging.UserSnapshotBackfill;

import io.confluent.kafka.serializers.KafkaAvroDeserializer;

/** Phase 9: every account is published once as a UserSnapshot for read models that start later (reporting). */
class UserSnapshotBackfillIntegrationTest extends IdentityIntegrationTest {

    @Autowired
    UserSnapshotBackfill backfill;

    @Test
    void everyAccountIsPublishedOnceWithItsRolesAndStatus() throws Exception {
        Session customer = newCustomer("snapshot");
        long accounts = jdbcClient.sql("SELECT COUNT(*) FROM users").query(Long.class).single();
        jdbcClient.sql("UPDATE data_backfills SET done_at = NULL WHERE name = 'user-snapshots'").update();
        long before = snapshotRows();

        backfill.onStart();
        backfill.onStart();   // done: nothing more

        assertThat(snapshotRows() - before).isEqualTo(accounts);
        byte[] payload = jdbcClient.sql("""
                        SELECT payload FROM outbox_events WHERE aggregate_type = 'identity' AND aggregate_id = :id
                        AND event_type = :type ORDER BY created_at DESC LIMIT 1""")
                .param("id", customer.userId()).param("type", UserSnapshot.class.getName())
                .query((rs, i) -> rs.getBytes("payload")).single();
        try (KafkaAvroDeserializer deserializer = new KafkaAvroDeserializer()) {
            deserializer.configure(Map.of("schema.registry.url", "mock://identity-it", "specific.avro.reader", true),
                    false);
            UserSnapshot snapshot = (UserSnapshot) deserializer.deserialize("identity.events", payload);
            assertThat(snapshot.getEmail()).isEqualTo(customer.email());
            assertThat(snapshot.getRoles()).containsExactly("CUSTOMER");
            assertThat(snapshot.getStatus()).isEqualTo("ACTIVE");
            assertThat(snapshot.getEmailVerified()).isTrue();
            assertThat(snapshot.getRegisteredAt()).isNotNull();
        }
    }

    private long snapshotRows() {
        return jdbcClient.sql("SELECT COUNT(*) FROM outbox_events WHERE event_type = :type")
                .param("type", UserSnapshot.class.getName()).query(Long.class).single();
    }
}
