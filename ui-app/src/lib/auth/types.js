export function toSession(response) {
  return { accessToken: response.accessToken, user: response.user };
}

/** True when the user has at least one of `roles`. */
export function hasAnyRole(user, roles) {
  return !!user && roles.some((role) => user.roles.includes(role));
}

/** True when the user has `permission`. Only shapes the UI: the API checks it again. */
export function hasPermission(user, permission) {
  return !!user && user.permissions.includes(permission);
}
