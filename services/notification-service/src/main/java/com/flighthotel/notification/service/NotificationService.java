package com.flighthotel.notification.service;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.web.PageResponse;
import com.flighthotel.notification.entity.Notification;
import com.flighthotel.notification.preference.NotificationPreferences;
import com.flighthotel.notification.preference.NotificationPreferences.Category;
import com.flighthotel.notification.preference.NotificationPreferences.Channel;
import com.flighthotel.notification.repository.NotificationRepository;

/** The customer's in-app notifications: created from events, read through the bell. Own notifications only. */
@Service
public class NotificationService {

    private final NotificationRepository notifications;
    private final NotificationPreferences preferences;
    private final RealtimePublisher realtime;
    private final Clock clock;

    public NotificationService(NotificationRepository notifications, NotificationPreferences preferences,
            RealtimePublisher realtime, Clock clock) {
        this.notifications = notifications;
        this.preferences = preferences;
        this.realtime = realtime;
        this.clock = clock;
    }

    public record NotificationView(UUID id, String category, String title, String message, String link,
            boolean read, Instant createdAt) {
        static NotificationView of(Notification notification) {
            return new NotificationView(notification.getId(), notification.getCategory(), notification.getTitle(),
                    notification.getMessage(), notification.getLink(), notification.getReadAt() != null,
                    notification.getCreatedAt());
        }
    }

    /**
     * Called by the event listeners in their transaction; tells the customer's open pages to refresh the bell. Skipped
     * when the customer turned this category off for the bell (and when it already exists for this source).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void create(UUID userId, String category, String title, String message, String link, String sourceEventId) {
        if (!preferences.enabled(userId, Category.valueOf(category), Channel.IN_APP)
                || notifications.existsBySourceEventId(sourceEventId)) {
            return;
        }
        Notification notification = notifications.save(new Notification(userId, category, title, message, link,
                sourceEventId, clock.instant()));
        realtime.publish(RealtimeMessage.of("notification.created", "NOTIFICATION", notification.getId().toString(),
                Map.of("category", category)), RealtimeAudience.user(userId));
    }

    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public PageResponse<NotificationView> mine(boolean unreadOnly, Category category, int page, int size) {
        UUID userId = CurrentUser.require().id();
        PageRequest paging = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 50),
                Sort.by(Sort.Direction.DESC, "createdAt"));
        if (category != null) {
            String only = category.name();
            return PageResponse.from(unreadOnly ? notifications.findByUserIdAndCategoryAndReadAtIsNull(userId, only,
                    paging) : notifications.findByUserIdAndCategory(userId, only, paging), NotificationView::of);
        }
        return PageResponse.from(unreadOnly ? notifications.findByUserIdAndReadAtIsNull(userId, paging)
                : notifications.findByUserId(userId, paging), NotificationView::of);
    }

    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public long unreadCount() {
        return notifications.countByUserIdAndReadAtIsNull(CurrentUser.require().id());
    }

    @PreAuthorize("isAuthenticated()")
    @Transactional
    public void markRead(UUID id) {
        UUID userId = CurrentUser.require().id();
        Notification notification = notifications.findById(id).filter(found -> found.getUserId().equals(userId))
                .orElseThrow(() -> new ResourceNotFoundException("Notification", id));
        notification.markRead(clock.instant());
        realtime.publish(RealtimeMessage.of("notification.read", "NOTIFICATION", id.toString(), Map.of()),
                RealtimeAudience.user(userId));
    }

    /** Back to unread (the Notification Center's "mark as unread"). */
    @PreAuthorize("isAuthenticated()")
    @Transactional
    public void markUnread(UUID id) {
        UUID userId = CurrentUser.require().id();
        Notification notification = notifications.findById(id).filter(found -> found.getUserId().equals(userId))
                .orElseThrow(() -> new ResourceNotFoundException("Notification", id));
        notification.markUnread();
        realtime.publish(RealtimeMessage.of("notification.read", "NOTIFICATION", id.toString(), Map.of()),
                RealtimeAudience.user(userId));
    }

    @PreAuthorize("isAuthenticated()")
    @Transactional
    public int markAllRead() {
        UUID userId = CurrentUser.require().id();
        int updated = notifications.markAllRead(userId, clock.instant());
        if (updated > 0) {
            realtime.publish(RealtimeMessage.of("notification.read", "NOTIFICATION", null, Map.of()),
                    RealtimeAudience.user(userId));
        }
        return updated;
    }
}
