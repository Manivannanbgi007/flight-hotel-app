package com.flighthotel.search.query;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

import com.flighthotel.common.security.AuthenticatedUser;
import com.flighthotel.common.security.CurrentUser;

/**
 * The viewer of the current request, from Spring Security's context: the access token was already verified
 * (signature, issuer, expiry, revocation) by common-lib before the controller runs. Without a token: a signed-out
 * visitor. Nothing the browser sends besides the token is trusted.
 */
@Component
public class ViewerResolver {

    private final ManagedHotelsClient managedHotels;

    public ViewerResolver(ManagedHotelsClient managedHotels) {
        this.managedHotels = managedHotels;
    }

    public Viewer current() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken jwt) {
            AuthenticatedUser user = CurrentUser.fromJwt(jwt.getToken());
            String token = jwt.getToken().getTokenValue();
            return Viewer.of(user, () -> managedHotels.hotelsOf(user.id().toString(), token));
        }
        return Viewer.anonymous();
    }
}
