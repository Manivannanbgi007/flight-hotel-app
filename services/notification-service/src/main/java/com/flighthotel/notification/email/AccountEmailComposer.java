package com.flighthotel.notification.email;

import java.time.Duration;
import java.util.List;
import java.util.Locale;

import org.springframework.stereotype.Component;
import org.springframework.web.util.UriComponentsBuilder;
import org.thymeleaf.ITemplateEngine;
import org.thymeleaf.context.Context;

import com.flighthotel.common.settings.SystemSettings;
import com.flighthotel.events.identity.AuthEmailRequested;

/**
 * Builds the account emails requested by identity-service ({@code identity-email.events}). One HTML layout
 * ({@code templates/email/account.html}) and one plain-text version for every type; only the wording differs.
 * All user-supplied values (the first name) are escaped by Thymeleaf.
 */
@Component
public class AccountEmailComposer {

    static final String TEMPLATE = "email/account";
    static final List<String> STAFF_PORTALS = List.of("admin", "hotel-manager", "support");

    private final ITemplateEngine templateEngine;
    private final SystemSettings settings;
    private final EmailProperties properties;

    public AccountEmailComposer(ITemplateEngine templateEngine, SystemSettings settings, EmailProperties properties) {
        this.templateEngine = templateEngine;
        this.settings = settings;
        this.properties = properties;
    }

    public EmailContent compose(AuthEmailRequested request) {
        String site = settings.getString("site.name", "FlightHotel");
        String support = settings.getString("support.email", "support@flighthotel.local");
        String validity = request.getExpiresAt() == null ? null
                : "This link is valid for " + describe(Duration.between(request.getRequestedAt(), request.getExpiresAt())) + ".";

        Message message = switch (request.getEmailType()) {
            case "VERIFY_EMAIL" -> new Message(
                    "Verify your email address",
                    "Confirm your email address",
                    List.of("Thanks for signing up for " + site + ". Please confirm your email address to activate your account."),
                    "Verify email", linkWithToken("/verify-email", request.getToken(), false), validity,
                    "If you did not create an account, you can ignore this email.");
            case "RESET_PASSWORD" -> new Message(
                    "Reset your password",
                    "Reset your password",
                    List.of("We received a request to reset the password of your " + site + " account."),
                    "Choose a new password", linkWithToken("/reset-password", request.getToken(), false), validity,
                    "If you did not ask for this, ignore this email. Your password stays the same.");
            case "ACCOUNT_INVITATION" -> new Message(
                    "Your " + site + " account is ready",
                    "Welcome to the " + site + " team",
                    List.of("An administrator created a " + site + " account for you.",
                            "Choose your password to start using it."),
                    "Set your password", invitationLink(request.getToken(), request.getPortal()), validity,
                    "If you were not expecting this, please contact " + support + ".");
            case "PASSWORD_CHANGED" -> new Message(
                    "Your password was changed",
                    "Your password was changed",
                    List.of("The password of your " + site + " account was just changed.",
                            "If this was you, no action is needed. If it was not, reset your password now and contact "
                                    + support + "."),
                    "Reset password", properties.appUrl("/forgot-password"), null,
                    "This is a security notification; it is sent even if you unsubscribed from other emails.");
            case "ACCOUNT_EXISTS" -> new Message(
                    "You already have a " + site + " account",
                    "You already have an account",
                    List.of("Someone (hopefully you) tried to create a new " + site
                            + " account with this email address, but an account already exists."),
                    "Log in", properties.appUrl("/login"), null,
                    "Forgot your password? Use \"Forgot password\" on the login page. If this was not you, ignore this email.");
            case "WELCOME" -> new Message(
                    "Welcome to " + site,
                    "Your account is ready",
                    List.of("Your email address is confirmed.",
                            "Search flights and hotels, save your travellers for faster booking and follow every booking live."),
                    "Start exploring", properties.appUrl("/"), null, null);
            default -> throw new IllegalArgumentException("Unknown account email type: " + request.getEmailType());
        };
        return render(message, request.getFirstName(), site, support);
    }

    private EmailContent render(Message message, String firstName, String site, String support) {
        Context context = new Context(Locale.ENGLISH);
        context.setVariable("siteName", site);
        context.setVariable("supportEmail", support);
        context.setVariable("firstName", firstName);
        context.setVariable("heading", message.heading());
        context.setVariable("paragraphs", message.paragraphs());
        context.setVariable("actionLabel", message.actionLabel());
        context.setVariable("actionUrl", message.actionUrl());
        context.setVariable("validity", message.validity());
        context.setVariable("footnote", message.footnote());
        String html = templateEngine.process(TEMPLATE, context);
        return new EmailContent(message.subject(), html, plainText(message, firstName, site, support));
    }

    private static String plainText(Message message, String firstName, String site, String support) {
        StringBuilder text = new StringBuilder();
        text.append("Hello ").append(firstName).append(",\n\n");
        message.paragraphs().forEach(p -> text.append(p).append("\n\n"));
        text.append(message.actionLabel()).append(": ").append(message.actionUrl()).append("\n\n");
        if (message.validity() != null) {
            text.append(message.validity()).append("\n\n");
        }
        if (message.footnote() != null) {
            text.append(message.footnote()).append("\n\n");
        }
        text.append("-- \n").append(site).append(" · ").append(support).append('\n');
        return text.toString();
    }

    /**
     * {@code /reset-password?token=…&invite=1}, plus {@code &portal=admin|hotel-manager|support} (Phase 11): the page
     * then sends the new staff member to their own sign-in. Any other value is left out.
     */
    private String invitationLink(String token, String portal) {
        String link = linkWithToken("/reset-password", token, true);
        return portal != null && STAFF_PORTALS.contains(portal) ? link + "&portal=" + portal : link;
    }

    private String linkWithToken(String path, String token, boolean invitation) {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("Email type needs a token");
        }
        UriComponentsBuilder uri = UriComponentsBuilder.fromUriString(properties.appUrl(path)).queryParam("token", token);
        if (invitation) {
            uri.queryParam("invite", "1");
        }
        return uri.encode().build().toUriString();
    }

    /** 24h → "24 hours", 72h → "3 days", 1h → "1 hour". */
    static String describe(Duration duration) {
        long hours = Math.round(duration.toMinutes() / 60.0);
        if (hours >= 48 && hours % 24 == 0) {
            return (hours / 24) + " days";
        }
        if (hours >= 1) {
            return hours == 1 ? "1 hour" : hours + " hours";
        }
        long minutes = Math.max(1, duration.toMinutes());
        return minutes == 1 ? "1 minute" : minutes + " minutes";
    }

    private record Message(String subject, String heading, List<String> paragraphs, String actionLabel,
                           String actionUrl, String validity, String footnote) {
    }
}
