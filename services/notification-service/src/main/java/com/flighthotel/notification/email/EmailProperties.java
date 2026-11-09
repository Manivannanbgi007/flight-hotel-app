package com.flighthotel.notification.email;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * @param from          sender address
 * @param appPublicUrl  base URL of the web app, used for links in emails (no trailing slash)
 */
@ConfigurationProperties("notification.email")
public record EmailProperties(
        @DefaultValue("no-reply@flighthotel.local") String from,
        @DefaultValue("http://localhost:3000") String appPublicUrl) {

    public String appUrl(String path) {
        String base = appPublicUrl.endsWith("/") ? appPublicUrl.substring(0, appPublicUrl.length() - 1) : appPublicUrl;
        return base + path;
    }
}
