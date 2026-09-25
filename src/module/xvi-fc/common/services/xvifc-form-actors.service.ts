import { Injectable } from '@nestjs/common';
import type { XvifcActorSourceDocument, XvifcFormActor, XvifcFormActorsResult } from '../types/xvifc-form-actors.type';

function getPopulatedName(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value !== 'object') return undefined;
  const name = (value as Record<string, unknown>)['name'];
  return typeof name === 'string' ? name : undefined;
}

function toIsoStringOrNull(value: unknown): string | null {
  if (!(value instanceof Date)) return null;
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

@Injectable()
export class XvifcFormActorsService {
  /**
   * Builds the actors timeline and resolves stateName from a lean populated form document.
   * Uses the SFC actor response format as the source of truth.
   * Safe against missing/null populated fields — returns null for absent values.
   *
   * @param doc - Lean form document with populated state, createdBy, updatedBy, and submittedBy refs.
   * @returns Actors array with designation and the resolved state name.
   */
  buildActorsAndStateName(doc: XvifcActorSourceDocument | null): XvifcFormActorsResult {
    const stateName = getPopulatedName(doc?.state) ?? '';
    const actors: XvifcFormActor[] = [
      {
        action: 'Created by',
        designation: 'State DMA Officer',
        by: getPopulatedName(doc?.createdBy) ?? null,
        date: toIsoStringOrNull(doc?.createdAt),
      },
      {
        action: 'Updated by',
        designation: 'State DMA Officer',
        by: getPopulatedName(doc?.updatedBy) ?? null,
        date: toIsoStringOrNull(doc?.updatedAt),
      },
      {
        action: 'Submitted by',
        designation: 'State DMA Officer',
        by: getPopulatedName(doc?.submittedBy) ?? null,
        date: toIsoStringOrNull(doc?.submittedAt),
      },
    ];
    return { actors, stateName };
  }
}
