package com.flighthotel.reporting.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import com.flighthotel.common.persistence.AuditableEntity;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Entity
@Table(name = "system_settings")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SystemSetting extends AuditableEntity {

    @Id
    @Column(name = "setting_key", length = 100)
    private String key;

    @Column(name = "setting_value", length = 2000)
    private String value;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "value_type", nullable = false, length = 20)
    private SettingValueType valueType;

    @Column(name = "description", nullable = false, length = 500)
    private String description;

    @Column(name = "is_public", nullable = false)
    private boolean publicSetting;

    /** Version that has been written to the outbox. Lower than {@link #version} = change not broadcast yet. */
    @Column(name = "published_version", nullable = false)
    private long publishedVersion;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    /**
     * Changes the value and marks the <b>next</b> version as published, so the value change and the publish marker
     * are saved in one update (one version increment).
     */
    public void changeValue(String newValue) {
        this.value = newValue;
        markNextVersionPublished();
    }

    public void markNextVersionPublished() {
        this.publishedVersion = this.version + 1;
    }

    public boolean isPublished() {
        return publishedVersion >= version;
    }
}
