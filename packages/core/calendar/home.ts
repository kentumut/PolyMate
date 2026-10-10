import type { CalendarEvent, Completion, StudyBlockInput } from '@polymate/contracts/calendar';
import { ContractError } from '@polymate/contracts/calendar';
import type { DateRange } from '@polymate/contracts/time';
import { GoogleApiError, type GoogleCalendarApi, type GoogleEvent } from './google-api';
import { isOwnedStudyBlock, newStudyBlockEvent, PROP_COMPLETION, summaryFor, toCalendarEvent } from './mapping';

/** Where a student's study blocks are stored. Google users still see them in the PolyMate week view. */
export type CalendarHome = 'polymate' | 'google';
export const CALENDAR_HOMES: readonly CalendarHome[] = ['polymate', 'google'];

export function parseCalendarHome(value: unknown): CalendarHome {
  if (value !== 'polymate' && value !== 'google') throw new ContractError('Choose the PolyMate calendar or Google Calendar.');
  return value;
}

/** A study block as it moves between calendars. The ID is kept so progress links stay attached. */
export type MovableBlock = StudyBlockInput & { id: string; completion: Completion };

/** One calendar's view of the owner's own study blocks. Every write is idempotent by block ID. */
export interface StudyBlockHome {
  listOwnBlocks(range: DateRange): Promise<MovableBlock[]>;
  /** Creates the block with this exact ID, or makes an earlier copy match it. */
  put(block: MovableBlock): Promise<void>;
  /** Removes the block; a block that is already gone counts as removed. */
  remove(id: string): Promise<void>;
}

export type MoveOutcome = Readonly<{ total: number; moved: number; complete: boolean }>;

/**
 * Copies each upcoming block to the new home, then removes it from the old one. Stops at the first
 * failure: a block is never removed before its copy is confirmed, so a retry finishes the move
 * without duplicating or losing anything.
 */
export async function moveStudyBlocks(from: StudyBlockHome, to: StudyBlockHome, range: DateRange): Promise<MoveOutcome> {
  const blocks = await from.listOwnBlocks(range);
  let moved = 0;
  for (const block of blocks) {
    try {
      await to.put(block);
      await from.remove(block.id);
    } catch {
      return { total: blocks.length, moved, complete: false };
    }
    moved++;
  }
  return { total: blocks.length, moved, complete: true };
}

export function toMovableBlock(event: CalendarEvent): MovableBlock {
  return { id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt, completion: event.completion };
}

// Google accepts only base32hex IDs; PolyMate block IDs (`pm` + hex) already qualify.
const GOOGLE_EVENT_ID = /^[a-v0-9]{5,1024}$/;
const MIGRATION_OPERATION = 'calendar-home-move';

/** The owner's study blocks in their primary Google Calendar. Personal events are never touched. */
export function googleStudyBlockHome(api: GoogleCalendarApi, ownerId: string): StudyBlockHome {
  const body = (block: MovableBlock) => {
    const event = newStudyBlockEvent(block, ownerId, MIGRATION_OPERATION);
    return {
      ...event,
      id: block.id,
      summary: summaryFor(block.title, block.completion),
      extendedProperties: { private: { ...event.extendedProperties!.private, [PROP_COMPLETION]: block.completion } },
    };
  };
  const matches = (event: GoogleEvent, block: MovableBlock) => {
    const mapped = toCalendarEvent(event, ownerId);
    return mapped?.title === block.title && mapped.startAt === block.startAt && mapped.endAt === block.endAt && mapped.completion === block.completion;
  };
  return {
    async listOwnBlocks(range) {
      const events = await api.list(range.from, range.to);
      return events.filter(event => isOwnedStudyBlock(event, ownerId)).flatMap(event => {
        const mapped = toCalendarEvent(event, ownerId);
        return mapped && !mapped.allDay ? [toMovableBlock(mapped)] : [];
      });
    },
    async put(block) {
      if (!GOOGLE_EVENT_ID.test(block.id)) throw new ContractError('This block cannot be copied to Google Calendar.');
      try {
        await api.insert(body(block));
        return;
      } catch (error) {
        if (!(error instanceof GoogleApiError && error.status === 409)) throw error;
      }
      // The ID exists already: an earlier attempt landed, or Google kept a deleted copy from a past move.
      const existing = await api.get(block.id, { includeCancelled: true });
      if (!existing || existing.extendedProperties?.private?.polymateOwner !== ownerId) throw new GoogleApiError(409, 'duplicate');
      if (existing.status !== 'cancelled' && matches(existing, block)) return;
      await api.patch(block.id, { ...body(block), status: 'confirmed' }, existing.etag);
    },
    async remove(id) {
      const current = await api.get(id);
      if (!current) return;
      if (!isOwnedStudyBlock(current, ownerId)) throw new GoogleApiError(403, 'forbidden');
      try {
        await api.delete(id, current.etag);
      } catch (error) {
        if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
      }
    },
  };
}
