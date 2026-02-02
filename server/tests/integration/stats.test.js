/**
 * Dashboard Stats API Tests
 */

import { runTest, get, assertOk, assertHasProperties } from '../helpers/utils.js';

const SUITE = 'Dashboard Stats';

export async function run() {
  // ==========================================
  // Stats API
  // ==========================================

  await runTest(SUITE, 'Stats API returns platform statistics', async () => {
    const res = await get('/api/stats');
    assertOk(res, 'Stats check');

    assertHasProperties(res.data, ['totalUsers', 'totalCatalogs'], 'Stats response');

    const { totalUsers, totalCatalogs } = res.data;
    const isNum = (v) => typeof v === 'number' && !isNaN(v);

    if (!isNum(totalUsers) || !isNum(totalCatalogs)) {
      throw new Error(`Invalid stats values: users=${totalUsers}, catalogs=${totalCatalogs}`);
    }
  });
}
