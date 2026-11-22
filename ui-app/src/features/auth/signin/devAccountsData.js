const password = 'DevTest@2026!';

/**
 * Development only, and only ever loaded by `devAccounts.js` when the build was made with VITE_DEV_ACCOUNTS=true. In a
 * normal build nothing imports this file, so it is not in the bundle or in its source map.
 */
export const DEV_ACCOUNTS = {
  CUSTOMER: [
    {
      label: 'Customer 1: trips, payments, notifications and tickets',
      email: 'dev.customer1@flighthotel.local',
      password,
    },
    { label: 'Customer 2: a second traveller', email: 'dev.customer2@flighthotel.local', password },
  ],
  ADMIN: [{ label: 'Administrator', email: 'dev.admin@flighthotel.local', password }],
  HOTEL_MANAGER: [
    { label: 'Hotel manager 1: two hotels', email: 'dev.manager1@flighthotel.local', password },
    { label: 'Hotel manager 2: one hotel', email: 'dev.manager2@flighthotel.local', password },
  ],
  SUPPORT: [{ label: 'Support agent', email: 'dev.support1@flighthotel.local', password }],
};
