import { expect, it } from 'vitest';
import { safeAuthDestination, loginPath, authDestinationFromSearch } from '../lib/auth-destination';
it('retains account links across the login redirect', () => {
  const destination = '/trade/access?account=ft_example_p1';
  expect(authDestinationFromSearch(loginPath(destination).split('?')[1])).toBe(destination);
  expect(safeAuthDestination('/checkout/success?session_id=cs_1')).toBe('/checkout/success?session_id=cs_1');
});
it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/login', '/signup', '/trade/../../login', '/trade\r\nLocation: evil', '/trade#token'])('rejects unsafe redirect %s', value => {
  expect(safeAuthDestination(value)).toBeNull();
});
