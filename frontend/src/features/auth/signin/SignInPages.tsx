import { SignInPage } from './SignInPage';

/** `/customer/login` */
export function CustomerLoginPage() {
  return <SignInPage portal="CUSTOMER" />;
}

/** `/admin/login` */
export function AdminLoginPage() {
  return <SignInPage portal="ADMIN" />;
}

/** `/hotel-manager/login` */
export function HotelManagerLoginPage() {
  return <SignInPage portal="HOTEL_MANAGER" />;
}

/** `/support/login` */
export function SupportLoginPage() {
  return <SignInPage portal="SUPPORT" />;
}
