package com.flighthotel.notification.preference;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.BusinessRuleException;

/**
 * Which messages a customer wants (API_DOCUMENTATION.md section 10): categories x channels, all on by default. E-mails
 * about bookings, payments and refunds are <b>locked</b> on (confirmations, receipts, cancellations), and account
 * messages are not configurable at all. Only the choices a customer changed are stored.
 */
@Component
public class NotificationPreferences {

    public enum Category { ACCOUNT, BOOKING, PAYMENT, REFUND, REMINDER, SUPPORT }

    public enum Channel { EMAIL, IN_APP }

    /** The categories a customer can see and change (ACCOUNT is always on). */
    public static final List<Category> CONFIGURABLE = List.of(Category.BOOKING, Category.PAYMENT, Category.REFUND,
            Category.REMINDER, Category.SUPPORT);
    private static final Set<Category> LOCKED_EMAIL = EnumSet.of(Category.BOOKING, Category.PAYMENT, Category.REFUND);

    private final JdbcClient jdbc;
    private final Clock clock;

    public NotificationPreferences(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public record Item(Category category, Channel channel, boolean enabled, boolean locked) {
    }

    public record Change(Category category, Channel channel, boolean enabled) {
    }

    public static boolean locked(Category category, Channel channel) {
        return category == Category.ACCOUNT || (channel == Channel.EMAIL && LOCKED_EMAIL.contains(category));
    }

    /** Whether to send this message to this user on this channel. */
    public boolean enabled(UUID userId, Category category, Channel channel) {
        if (locked(category, channel)) {
            return true;
        }
        return jdbc.sql("""
                        SELECT enabled FROM notification_preferences
                        WHERE user_id = UUID_TO_BIN(:user) AND category = :category AND channel = :channel""")
                .param("user", userId.toString()).param("category", category.name()).param("channel", channel.name())
                .query(Boolean.class).optional().orElse(true);
    }

    @Transactional(readOnly = true)
    public List<Item> of(UUID userId) {
        Map<String, Boolean> stored = new HashMap<>();
        jdbc.sql("SELECT category, channel, enabled FROM notification_preferences WHERE user_id = UUID_TO_BIN(:user)")
                .param("user", userId.toString())
                .query(rs -> {
                    stored.put(rs.getString("category") + "|" + rs.getString("channel"), rs.getBoolean("enabled"));
                });
        List<Item> items = new ArrayList<>();
        for (Category category : CONFIGURABLE) {
            for (Channel channel : Channel.values()) {
                boolean locked = locked(category, channel);
                items.add(new Item(category, channel,
                        locked || stored.getOrDefault(category + "|" + channel, true), locked));
            }
        }
        return items;
    }

    /** Applies the changes; turning off a locked item is refused (nothing is changed then). */
    @Transactional
    public List<Item> change(UUID userId, List<Change> changes) {
        for (Change change : changes) {
            if (change.category() == Category.ACCOUNT
                    || (locked(change.category(), change.channel()) && !change.enabled())) {
                throw new BusinessRuleException("PREFERENCE_LOCKED", "E-mails about your bookings, payments and "
                        + "refunds are always sent.", Map.of("category", change.category().name(),
                        "channel", change.channel().name()));
            }
        }
        LocalDateTime now = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
        for (Change change : changes) {
            if (locked(change.category(), change.channel())) {
                continue;
            }
            jdbc.sql("""
                            INSERT INTO notification_preferences (user_id, category, channel, enabled, updated_at)
                            VALUES (UUID_TO_BIN(:user), :category, :channel, :enabled, :now)
                            ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_at = VALUES(updated_at)""")
                    .param("user", userId.toString()).param("category", change.category().name())
                    .param("channel", change.channel().name()).param("enabled", change.enabled()).param("now", now)
                    .update();
        }
        return of(userId);
    }
}
