package com.flighthotel.notification.controller;

import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.web.PageResponse;
import com.flighthotel.notification.service.NotificationService;
import com.flighthotel.notification.service.NotificationService.NotificationView;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** The bell: my in-app notifications. */
@RestController
@RequestMapping("/api/notifications")
@Tag(name = "Notifications", description = "In-app notifications of the logged-in customer")
public class NotificationController {

    private final NotificationService notifications;

    public NotificationController(NotificationService notifications) {
        this.notifications = notifications;
    }

    @GetMapping
    @Operation(summary = "My notifications, newest first")
    public PageResponse<NotificationView> mine(@RequestParam(defaultValue = "false") boolean unreadOnly,
            @RequestParam(required = false) com.flighthotel.notification.preference.NotificationPreferences.Category category,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return notifications.mine(unreadOnly, category, page, size);
    }

    @GetMapping("/unread-count")
    @Operation(summary = "How many notifications are unread")
    public Map<String, Long> unreadCount() {
        return Map.of("count", notifications.unreadCount());
    }

    @PostMapping("/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Mark one notification as read")
    public void markRead(@PathVariable UUID id) {
        notifications.markRead(id);
    }

    @PostMapping("/{id}/unread")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Mark one notification as unread again")
    public void markUnread(@PathVariable UUID id) {
        notifications.markUnread(id);
    }

    @PostMapping("/read-all")
    @Operation(summary = "Mark all notifications as read")
    public Map<String, Integer> markAllRead() {
        return Map.of("updated", notifications.markAllRead());
    }
}
