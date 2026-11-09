package com.flighthotel.identity.mapper;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

import com.flighthotel.identity.dto.AdminUserDtos.AdminUserResponse;
import com.flighthotel.identity.dto.AuthDtos.AuthUser;
import com.flighthotel.identity.dto.CustomerDtos.LoginHistoryResponse;
import com.flighthotel.identity.dto.CustomerDtos.PassengerResponse;
import com.flighthotel.identity.dto.CustomerDtos.PreferencesDto;
import com.flighthotel.identity.dto.CustomerDtos.ProfileResponse;
import com.flighthotel.identity.entity.CustomerPassenger;
import com.flighthotel.identity.entity.LoginHistory;
import com.flighthotel.identity.entity.TravelPreferences;
import com.flighthotel.identity.entity.User;

/** Entity → response mapping. Entities never leave the service layer. */
@Mapper
public interface IdentityMapper {

    @Mapping(target = "roles", expression = "java(user.roleNames())")
    @Mapping(target = "permissions", expression = "java(user.permissionCodes())")
    @Mapping(target = "hasPhoto", expression = "java(user.getProfilePhotoKey() != null)")
    AuthUser toAuthUser(User user);

    @Mapping(target = "roles", expression = "java(user.roleNames())")
    @Mapping(target = "hasPhoto", expression = "java(user.getProfilePhotoKey() != null)")
    @Mapping(target = "memberSince", source = "createdAt")
    ProfileResponse toProfile(User user);

    @Mapping(target = "roles", expression = "java(user.roleNames())")
    AdminUserResponse toAdminUser(User user);

    /** The full passport number is never returned; only the last 4 characters. */
    @Mapping(target = "hasPassport", expression = "java(passenger.hasPassport())")
    @Mapping(target = "passportNumberMasked",
            expression = "java(passenger.hasPassport() ? \"••••\" + passenger.getPassportLast4() : null)")
    PassengerResponse toPassenger(CustomerPassenger passenger);

    PreferencesDto toPreferences(TravelPreferences preferences);

    LoginHistoryResponse toLoginHistory(LoginHistory history);
}
