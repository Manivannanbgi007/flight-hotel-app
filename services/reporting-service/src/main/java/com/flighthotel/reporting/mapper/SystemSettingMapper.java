package com.flighthotel.reporting.mapper;

import org.mapstruct.Mapper;

import com.flighthotel.reporting.dto.PublicSettingResponse;
import com.flighthotel.reporting.dto.SystemSettingResponse;
import com.flighthotel.reporting.entity.SystemSetting;

@Mapper
public interface SystemSettingMapper {

    SystemSettingResponse toResponse(SystemSetting setting);

    PublicSettingResponse toPublicResponse(SystemSetting setting);
}
