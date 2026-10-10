import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStudyPlan, getStudyPreferences, linkedStudyBlocks, saveStudyPlan, withPlanningLock } from '../packages/db/src/planning';
import { DEFAULT_STUDY_PREFERENCES, type StoredStudyPlan } from '../packages/contracts/src/planning';

const mocks = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn(), release: vi.fn(), ensure: vi.fn(), state: vi.fn() }));
vi.mock('../packages/db/src/connection', () => ({ getPool: () => ({ query: mocks.query, connect: async () => ({ query: mocks.clientQuery, release: mocks.release }) }) }));
vi.mock('../packages/db/src/google-oauth', () => ({ ensureUser: mocks.ensure }));
vi.mock('../packages/db/src/study-progress', () => ({ studyProgressStore: { state: mocks.state } }));
const owner = { userId: crypto.randomUUID(), externalId: 'student@example.test', displayName: 'Student' };
const snapshot: StoredStudyPlan = {
  plan: { id: crypto.randomUUID(), createdAt: '2026-10-12T06:00:00Z', expiresAt: '2026-10-12T06:30:00Z',
    horizon: { from: '2026-10-12T06:00:00Z', to: '2026-10-19T06:00:00Z' }, preferences: DEFAULT_STUDY_PREFERENCES,
    blocks: [{ assignmentId: crypto.randomUUID(), operationId: crypto.randomUUID(), title: 'Sheet', startAt: '2026-10-12T07:00:00Z', endAt: '2026-10-12T07:50:00Z' }],
    unscheduled: [], preservedMinutes: 0 },
  assignments: [], linkedEvents: [], approved: false, results: [],
};
beforeEach(() => {
  vi.resetAllMocks(); mocks.query.mockResolvedValue({ rows: [] }); mocks.clientQuery.mockResolvedValue({ rows: [] });
  mocks.state.mockResolvedValue({ links: [], reports: [] });
});

describe('durable owner-scoped planning repository', () => {
  it('commits preferences, sealed server data, operation links and shared progress intents together', async () => {
    await saveStudyPlan(owner, snapshot);
    expect(mocks.ensure).toHaveBeenCalledWith(owner);
    const calls = mocks.clientQuery.mock.calls;
    expect(calls[0][0]).toBe('BEGIN'); expect(calls.at(-1)![0]).toBe('COMMIT');
    expect(calls.find(([sql]) => sql.includes('INSERT INTO study_plan_blocks'))![1]).toEqual([
      snapshot.plan.blocks[0].operationId, owner.userId, snapshot.plan.id, snapshot.plan.blocks[0].assignmentId,
    ]);
    expect(calls.find(([sql]) => sql.includes('INSERT INTO assignment_block_intents'))![1]).toEqual([
      owner.userId, snapshot.plan.blocks[0].operationId, snapshot.plan.blocks[0].assignmentId,
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rolls back a failed link insertion instead of leaving an applyable partial draft', async () => {
    mocks.clientQuery.mockImplementation(async sql => { if (sql.includes('INSERT INTO assignment_block_intents')) throw new Error('conflict'); return { rows: [] }; });
    await expect(saveStudyPlan(owner, snapshot)).rejects.toThrow('conflict');
    expect(mocks.clientQuery.mock.calls.at(-1)![0]).toBe('ROLLBACK');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('always scopes plan and preference reads to the resolved owner', async () => {
    await getStudyPreferences(owner.userId); await getStudyPlan(owner.userId, snapshot.plan.id);
    expect(mocks.query.mock.calls[0][1]).toEqual([owner.userId]);
    expect(mocks.query.mock.calls[1]).toEqual([expect.stringContaining('WHERE owner_id = $1 AND id = $2'), [owner.userId, snapshot.plan.id]]);
  });

  it('uses shared progress links and excludes reported sessions, deleted blocks, and this draft’s own writes', async () => {
    mocks.state.mockResolvedValue({ links: [
      { eventId: 'kept', assignmentId: 'a', sessionRevision: 1, deleted: false },
      { eventId: 'reported', assignmentId: 'a', sessionRevision: 1, deleted: false },
      { eventId: 'deleted', assignmentId: 'a', sessionRevision: 1, deleted: true },
      { eventId: 'own', assignmentId: 'a', sessionRevision: 1, deleted: false },
    ], reports: [{ eventId: 'reported', sessionRevision: 1 }] });
    mocks.query.mockResolvedValue({ rows: [{ event_id: 'own' }] });
    expect(await linkedStudyBlocks(owner.userId, snapshot.plan.id)).toEqual([{ assignmentId: 'a', eventId: 'kept' }]);
    expect(mocks.state).toHaveBeenCalledWith(owner.userId);
    expect(mocks.query.mock.calls[0][1]).toEqual([owner.userId, snapshot.plan.id]);
  });

  it('rejects concurrent planning and releases its lock after failures', async () => {
    mocks.clientQuery.mockResolvedValueOnce({ rows: [{ locked: false }] });
    const run = vi.fn();
    await expect(withPlanningLock(owner.userId, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    mocks.clientQuery.mockResolvedValueOnce({ rows: [{ locked: true }] });
    await expect(withPlanningLock(owner.userId, async () => { throw new Error('network'); })).rejects.toThrow('network');
    expect(mocks.clientQuery.mock.calls.at(-1)).toEqual([expect.stringContaining('pg_advisory_unlock'), [owner.userId]]);
  });
});
