import type { SettlementKind } from './types';

export const SETTLEMENT_TYPES: readonly SettlementKind[] = ['hamlet', 'village', 'town', 'fortifiedTown'];

/** True for the structure types that are whole settlements rather than single buildings. */
export function isSettlementType(type: string): type is SettlementKind {
  return (SETTLEMENT_TYPES as readonly string[]).includes(type);
}
