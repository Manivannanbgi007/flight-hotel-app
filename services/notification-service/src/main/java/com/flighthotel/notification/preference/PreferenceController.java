package com.flighthotel.notification.preference;

import java.util.List;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.notification.newsletter.NewsletterService;
import com.flighthotel.notification.preference.NotificationPreferences.Category;
import com.flighthotel.notification.preference.NotificationPreferences.Change;
import com.flighthotel.notification.preference.NotificationPreferences.Channel;
import com.flighthotel.notification.preference.NotificationPreferences.Item;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** The logged-in customer's notification choices and the newsletter subscription of their account e-mail. */
@RestController
@RequestMapping("/api/notifications/preferences")
@Tag(name = "Notifications", description = "In-app notifications of the logged-in customer")
public class PreferenceController {

    private final NotificationPreferences preferences;
    private final NewsletterService newsletter;

    public PreferenceController(NotificationPreferences preferences, NewsletterService newsletter) {
        this.preferences = preferences;
        this.newsletter = newsletter;
    }

    public record Newsletter(boolean subscribed, String status) {
    }

    public record PreferencesView(List<Item> items, Newsletter newsletter) {
    }

    public record ItemChange(@NotNull Category category, @NotNull Channel channel, boolean enabled) {
    }

    public record PreferencesUpdate(@Size(max = 20) List<@NotNull @Valid ItemChange> items, Boolean newsletter) {
    }

    @GetMapping
    @PreAuthorize("isAuthenticated()")
    @Operation(summary = "My notification preferences (EMAIL / IN_APP per category) and newsletter subscription")
    public PreferencesView get() {
        AuthenticatedUser user = CurrentUser.require();
        return view(user, preferences.of(user.id()));
    }

    @PutMapping
    @PreAuthorize("isAuthenticated()")
    @Transactional
    @Operation(summary = "Change some preferences (locked e-mails cannot be turned off) and/or the newsletter")
    public PreferencesView update(@Valid @RequestBody PreferencesUpdate update) {
        AuthenticatedUser user = CurrentUser.require();
        List<Item> items = update.items() == null || update.items().isEmpty() ? preferences.of(user.id())
                : preferences.change(user.id(), update.items().stream()
                        .map(item -> new Change(item.category(), item.channel(), item.enabled())).toList());
        if (update.newsletter() != null) {
            newsletter.account(user.id(), user.email(), update.newsletter());
        }
        return view(user, items);
    }

    private PreferencesView view(AuthenticatedUser user, List<Item> items) {
        String status = newsletter.status(user.email());
        return new PreferencesView(items, new Newsletter("SUBSCRIBED".equals(status), status));
    }
}
