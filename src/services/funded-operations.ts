import { z } from 'zod';
import { fundedAccessCall } from './funded-access';
const count = z.number().int().nonnegative();
const schema = z.object({
  status: z.enum(['missing', 'invalid', 'stale', 'incomplete', 'attention', 'clear']),
  checkedAt: z.string().datetime({ offset: true }).nullable(), readAt: z.string().datetime({ offset: true }),
  complete: z.boolean(), orders: count.nullable(), findingsTotal: count.nullable(), findingsTruncated: z.boolean(),
  findings: z.array(z.object({ orderId: z.string(), reason: z.string() })).max(200), states: z.record(count),
  freshnessMinutes: z.number().positive(), providerReconciliation: z.literal(false),
  purchasesPaused: z.boolean(), progressionPaused: z.boolean(),
});
export type OperationsReport = Required<z.infer<typeof schema>>;
export async function getFundedOperations() {
  return schema.parse(await fundedAccessCall('fundedOperations', { action: 'status' })) as OperationsReport;
}
