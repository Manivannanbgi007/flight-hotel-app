package com.flighthotel.reporting.scheduler;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import com.flighthotel.reporting.service.SystemSettingService;

/** On startup, broadcasts settings that were never published (for example defaults added by a migration). */
@Component
public class SettingsBroadcastOnStartup {

    private static final Logger log = LoggerFactory.getLogger(SettingsBroadcastOnStartup.class);

    private final SystemSettingService settingService;

    public SettingsBroadcastOnStartup(SystemSettingService settingService) {
        this.settingService = settingService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void publishPendingSettings() {
        int published = settingService.publishPendingChanges();
        if (published > 0) {
            log.info("Broadcast {} unpublished system settings", published);
        }
    }
}
