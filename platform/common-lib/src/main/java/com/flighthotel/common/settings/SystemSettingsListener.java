package com.flighthotel.common.settings;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.annotation.PartitionOffset;
import org.springframework.kafka.annotation.TopicPartition;

import com.flighthotel.events.settings.SystemSettingChanged;

/**
 * Feeds {@link SystemSettings}. The topic has one partition and is compacted, so reading it from offset 0 on every
 * start rebuilds the full set of current values.
 */
public class SystemSettingsListener {

    public static final String TOPIC = "settings.events";

    private final SystemSettings systemSettings;

    public SystemSettingsListener(SystemSettings systemSettings) {
        this.systemSettings = systemSettings;
    }

    @KafkaListener(
            id = "${spring.application.name}-system-settings",
            groupId = "${spring.application.name}-system-settings",
            topicPartitions = @TopicPartition(topic = TOPIC,
                    partitionOffsets = @PartitionOffset(partition = "0", initialOffset = "0")))
    public void onSettingChanged(ConsumerRecord<String, Object> record) {
        if (record.value() instanceof SystemSettingChanged change) {
            systemSettings.apply(change);
        }
    }
}
