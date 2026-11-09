package com.flighthotel.reporting.service.impl;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.flighthotel.common.error.BusinessRuleException;
import com.flighthotel.common.error.ConflictException;
import com.flighthotel.common.error.ResourceNotFoundException;
import com.flighthotel.common.outbox.OutboxEventPublisher;
import com.flighthotel.common.persistence.SecurityAuditorAware;
import com.flighthotel.common.realtime.RealtimeAudience;
import com.flighthotel.common.realtime.RealtimeMessage;
import com.flighthotel.common.realtime.RealtimePublisher;
import com.flighthotel.common.security.CurrentUser;
import com.flighthotel.common.security.Roles;
import com.flighthotel.events.settings.SystemSettingChanged;
import com.flighthotel.reporting.dto.PublicSettingResponse;
import com.flighthotel.reporting.dto.SystemSettingResponse;
import com.flighthotel.reporting.dto.UpdateSystemSettingRequest;
import com.flighthotel.reporting.entity.SystemSetting;
import com.flighthotel.reporting.mapper.SystemSettingMapper;
import com.flighthotel.reporting.repository.SystemSettingRepository;
import com.flighthotel.reporting.service.SystemSettingService;

@Service
public class SystemSettingServiceImpl implements SystemSettingService {

    static final String AGGREGATE_TYPE = "settings";

    private final SystemSettingRepository repository;
    private final SystemSettingMapper mapper;
    private final OutboxEventPublisher outbox;
    private final RealtimePublisher realtime;

    public SystemSettingServiceImpl(SystemSettingRepository repository, SystemSettingMapper mapper,
            OutboxEventPublisher outbox, RealtimePublisher realtime) {
        this.repository = repository;
        this.mapper = mapper;
        this.outbox = outbox;
        this.realtime = realtime;
    }

    @Override
    @Transactional(readOnly = true)
    @PreAuthorize("hasRole('ADMIN')")
    public List<SystemSettingResponse> findAll() {
        return repository.findAllByOrderByKeyAsc().stream().map(mapper::toResponse).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<PublicSettingResponse> findPublic() {
        return repository.findByPublicSettingTrueOrderByKeyAsc().stream().map(mapper::toPublicResponse).toList();
    }

    @Override
    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public SystemSettingResponse update(String key, UpdateSystemSettingRequest request) {
        SystemSetting setting = repository.findById(key)
                .orElseThrow(() -> new ResourceNotFoundException("System setting", key));
        if (!Objects.equals(setting.getVersion(), request.expectedVersion())) {
            throw new ConflictException("SETTING_CHANGED_BY_SOMEONE_ELSE",
                    "This setting was changed by someone else. Reload and try again.");
        }
        String value = request.value().trim();
        if (!setting.getValueType().isValid(value)) {
            throw new BusinessRuleException("INVALID_SETTING_VALUE",
                    "Value is not a valid " + setting.getValueType().name().toLowerCase(),
                    Map.of("key", key, "valueType", setting.getValueType().name()));
        }

        setting.changeValue(value);
        repository.saveAndFlush(setting);
        publish(setting, CurrentUser.require().id().toString());

        realtime.publish(
                RealtimeMessage.of("settings.changed", "SYSTEM_SETTING", key, Map.of("version", setting.getVersion())),
                RealtimeAudience.roles(Roles.ADMIN));
        return mapper.toResponse(setting);
    }

    @Override
    @Transactional
    public int publishPendingChanges() {
        List<SystemSetting> pending = repository.findUnpublishedForUpdate();
        for (SystemSetting setting : pending) {
            setting.markNextVersionPublished();
            repository.saveAndFlush(setting);
            publish(setting, SecurityAuditorAware.SYSTEM);
        }
        return pending.size();
    }

    private void publish(SystemSetting setting, String changedBy) {
        SystemSettingChanged event = SystemSettingChanged.newBuilder()
                .setKey(setting.getKey())
                .setValue(setting.getValue())
                .setValueType(setting.getValueType().name())
                .setVersion(setting.getVersion())
                .setChangedBy(changedBy)
                .setChangedAt(Instant.now())
                .build();
        outbox.publish(AGGREGATE_TYPE, setting.getKey(), event);
    }
}
