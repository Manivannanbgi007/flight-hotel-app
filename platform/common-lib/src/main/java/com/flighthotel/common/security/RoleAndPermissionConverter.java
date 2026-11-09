package com.flighthotel.common.security;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Maps token claims to Spring Security authorities:
 * {@code roles: ["ADMIN"]} → {@code ROLE_ADMIN}, {@code permissions: ["BOOKING_READ_ANY"]} → {@code BOOKING_READ_ANY}.
 * <p>
 * So services can write {@code @PreAuthorize("hasRole('ADMIN')")} or {@code hasAuthority('BOOKING_READ_ANY')}.
 */
public class RoleAndPermissionConverter implements Converter<Jwt, Collection<GrantedAuthority>> {

    @Override
    public Collection<GrantedAuthority> convert(Jwt jwt) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        CurrentUser.stringSet(jwt.getClaim(JwtClaims.ROLES))
                .forEach(role -> authorities.add(new SimpleGrantedAuthority("ROLE_" + role)));
        CurrentUser.stringSet(jwt.getClaim(JwtClaims.PERMISSIONS))
                .forEach(permission -> authorities.add(new SimpleGrantedAuthority(permission)));
        return authorities;
    }
}
