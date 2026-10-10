import { describe, expect, it } from 'vitest';
import { parseAssignment, parseAssignmentCreateRequest, parseAssignmentInput } from '../packages/contracts/src/assignments';
import { initialAssignmentFields, validateAssignmentFields } from '../apps/web/components/study/assignment-form';

const fields = { title: '  Algorithms   sheet 4 ', date: '2026-10-16', time: '18:00', estimatedMinutes: '150' };
const input = { title: 'Algorithms sheet 4', dueAt: '2026-10-16T16:00:00.000Z', estimatedMinutes: 150 };
const requestId = '00000000-0000-4000-8000-000000000001';

describe('assignment deadline and effort validation', () => {
  it('collects a full Zurich deadline and normalizes title and minute units', () => {
    expect(validateAssignmentFields(fields)).toEqual({ input });
    expect(validateAssignmentFields({ ...fields, date: '2026-01-16' }).input?.dueAt).toBe('2026-01-16T17:00:00.000Z');
    expect(initialAssignmentFields(input)).toEqual({ ...fields, title: input.title });
  });

  it('does not guess a date-only deadline or an effort estimate', () => {
    expect(validateAssignmentFields(initialAssignmentFields()).errors).toMatchObject({
      title: expect.any(String), date: expect.any(String), time: expect.any(String), estimatedMinutes: expect.any(String),
    });
    expect(validateAssignmentFields({ ...fields, time: '' }).input).toBeUndefined();
  });

  it('rejects impossible dates, DST gaps, and ambiguous Zurich times', () => {
    expect(validateAssignmentFields({ ...fields, date: '2026-02-30' }).errors?.date).toBeDefined();
    expect(validateAssignmentFields({ ...fields, date: '0000-01-01' }).errors?.date).toBeDefined();
    expect(validateAssignmentFields({ ...fields, date: '2026-03-29', time: '02:30' }).errors?.time).toContain('does not exist');
    expect(validateAssignmentFields({ ...fields, date: '2026-10-25', time: '02:30' }).errors?.time).toContain('occurs twice');
  });

  it.each(['0', '-1', '15.5', '', 'Infinity', '2147483648'])('rejects invalid minute estimate %s', minutes => {
    expect(validateAssignmentFields({ ...fields, estimatedMinutes: minutes }).input).toBeUndefined();
    expect(validateAssignmentFields({ ...fields, estimatedMinutes: minutes }).errors?.estimatedMinutes).toBeDefined();
  });

  it('bounds titles and validates the same input on the server', () => {
    expect(validateAssignmentFields({ ...fields, title: 'x'.repeat(201) }).errors?.title).toBeDefined();
    expect(parseAssignmentInput({ ...input, dueAt: '2026-10-16T18:00:00+02:00' })).toEqual(input);
    expect(() => parseAssignmentInput({ ...input, dueAt: '2026-02-30T10:00:00Z' })).toThrow('valid deadline');
    expect(() => parseAssignmentInput({ ...input, dueAt: '2026-10-16T18:00:00' })).toThrow('timezone');
  });

  it('does not accept client-selected owners, progress, or non-UUID request IDs', () => {
    expect(parseAssignmentCreateRequest({ ...input, clientRequestId: requestId })).toEqual({ ...input, clientRequestId: requestId });
    for (const extra of [{ ownerId: 'other' }, { remainingMinutes: 0 }, { status: 'completed' }, { version: 99 }]) {
      expect(() => parseAssignmentCreateRequest({ ...input, clientRequestId: requestId, ...extra })).toThrow('unsupported fields');
    }
    expect(() => parseAssignmentCreateRequest({ ...input, clientRequestId: 'invalid' })).toThrow('UUID');
  });

  it('rejects malformed save confirmations instead of displaying false success', () => {
    const saved = { ...input, id: requestId, remainingMinutes: 150, status: 'open', version: 1 };
    expect(parseAssignment(saved)).toEqual(saved);
    for (const changes of [{ id: 'invalid' }, { version: 0 }, { status: 'invented' }, { remainingMinutes: -1 }]) {
      expect(() => parseAssignment({ ...saved, ...changes })).toThrow();
    }
  });
});
