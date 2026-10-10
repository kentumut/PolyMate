import { describe, expect, it, vi } from 'vitest';
import { OpenClawAutomationScheduler } from '../apps/web/lib/agent-automations';
import type { OwnerContext } from '../packages/core/src/identity';
import type { AutomationSpec } from '../packages/core/agent/automations';

const owner: OwnerContext = { userId: '55555555-5555-5555-8555-555555555555', externalId: 'student@example.edu', displayName: 'Student' };
const spec: AutomationSpec = {
  key: 'moodle-weekly-check', name: 'Weekly Moodle check', schedule: { expression: '0 7 * * 1', timezone: 'Europe/Zurich' },
  prompt: 'Check for assignment changes and report the source.',
  tools: ['moodle_get_calendar_events', 'polymate_check_connections'],
};
const env = { OPENCLAW_GATEWAY_HTTP_URL: 'http://openclaw.internal:18789', OPENCLAW_GATEWAY_TOKEN: 'operator-secret', OPENCLAW_AGENT_ID: 'main', OPENCLAW_SCHEDULER_AGENT_ID: 'polymate-scheduler' };

describe('shared OpenClaw automation adapter', () => {
  it('registers owner-scoped jobs on OpenClaw with a narrow tool policy', async () => {
    const save = vi.fn().mockResolvedValue({ id: '66666666-6666-5666-8666-666666666666', key: spec.key, gatewayJobId: 'job_123', name: spec.name, ownerId: owner.userId, allowedTools: [...spec.tools] });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true, result: { content: [{ type: 'text', text: '{"id":"job_123"}' }], details: { id: 'job_123' } } }));
    const scheduler = new OpenClawAutomationScheduler({ save, find: vi.fn(), remove: vi.fn() }, fetchImpl, env);
    const result = await scheduler.register(owner, spec);
    expect(result).toEqual({ id: '66666666-6666-5666-8666-666666666666', key: spec.key, name: spec.name });
    const call = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(call[1]?.body)) as { tool: string; action: string; agentId: string; sessionKey: string; args: { job: Record<string, unknown> } };
    expect(body).toMatchObject({ tool: 'cron', action: 'add', agentId: 'polymate-scheduler', sessionKey: 'agent:polymate-scheduler:main' });
    expect(body.args.job).toMatchObject({ agentId: 'main', schedule: { kind: 'cron', expr: spec.schedule.expression, tz: 'Europe/Zurich' }, sessionTarget: 'isolated', delivery: { mode: 'none' } });
    expect((body.args.job.payload as { toolsAllow: string[] }).toolsAllow).toEqual(spec.tools);
    expect(JSON.stringify(body)).not.toContain(owner.userId);
    expect(save).toHaveBeenCalledWith(owner, expect.objectContaining({ gatewayJobId: 'job_123', allowedTools: spec.tools }));
    expect(new Headers(call[1]?.headers).get('authorization')).toBe('Bearer operator-secret');
  });

  it('cancels only a registration belonging to the authenticated owner', async () => {
    const row = { id: '66666666-6666-5666-8666-666666666666', ownerId: owner.userId, key: spec.key, gatewayJobId: 'job_123', name: spec.name, allowedTools: [...spec.tools] };
    const find = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    const remove = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true, result: { content: [], details: { ok: true, removed: true } } }));
    const scheduler = new OpenClawAutomationScheduler({ save: vi.fn(), find, remove }, fetchImpl, env);
    await scheduler.cancel({ ...owner, userId: '77777777-7777-5777-8777-777777777777' }, row.id);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    await scheduler.cancel(owner, row.id);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({ tool: 'cron', action: 'remove', args: { jobId: 'job_123' } });
    expect(remove).toHaveBeenCalledWith(owner.userId, row.id);
  });

  it('removes an OpenClaw job if the owner registration cannot be persisted', async () => {
    const save = vi.fn().mockRejectedValue(new Error('database write failed'));
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const action = (JSON.parse(String(init?.body)) as { action: string }).action;
      return Response.json({ ok: true, result: { content: [], details: action === 'add' ? { id: 'job_123' } : { ok: true, removed: true } } });
    });
    const scheduler = new OpenClawAutomationScheduler({ save, find: vi.fn(), remove: vi.fn() }, fetchImpl, env);
    await expect(scheduler.register(owner, spec)).rejects.toThrow('database write failed');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({ action: 'remove', args: { jobId: 'job_123' } });
  });
});
