import type { OwnerContext } from '@polymate/core/identity';
import type { OnboardingProfile, OnboardingState } from '@polymate/contracts/onboarding';
import { getPool } from './connection';
import { ensureUser } from './google-oauth';

type OnboardingRow = { goal: OnboardingProfile['goal']; session_minutes: OnboardingProfile['sessionMinutes']; coach_cadence: OnboardingProfile['coachCadence'] };

const profileFrom = (row: OnboardingRow): OnboardingProfile => ({ goal: row.goal, sessionMinutes: row.session_minutes, coachCadence: row.coach_cadence });

export async function getOnboardingState(owner: OwnerContext): Promise<OnboardingState> {
  await ensureUser(owner);
  const result = await getPool().query<OnboardingRow>('SELECT goal, session_minutes, coach_cadence FROM student_onboarding WHERE owner_id = $1', [owner.userId]);
  return result.rows[0] ? { completed: true, profile: profileFrom(result.rows[0]) } : { completed: false, profile: null };
}

export async function completeOnboarding(owner: OwnerContext, profile: OnboardingProfile): Promise<OnboardingState> {
  await ensureUser(owner);
  const goals: Record<OnboardingProfile['goal'], string> = {
    deadline: 'Primary study goal: finish urgent work.',
    exam: 'Primary study goal: build exam confidence.',
    balance: 'Primary study goal: keep the study week sustainable.',
  };
  const cadence = profile.coachCadence === 'proactive' ? 'Coaching preference: flag study risks early.' : 'Coaching preference: provide weekly summaries without proactive check-ins.';
  const memories = [goals[profile.goal], `Preferred focus session length: ${profile.sessionMinutes} minutes.`, cadence];
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO student_onboarding (owner_id, goal, session_minutes, coach_cadence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_id) DO UPDATE SET goal = EXCLUDED.goal, session_minutes = EXCLUDED.session_minutes,
         coach_cadence = EXCLUDED.coach_cadence, updated_at = now()`,
      [owner.userId, profile.goal, profile.sessionMinutes, profile.coachCadence],
    );
    await client.query(
      `INSERT INTO check_in_preferences (owner_id, paused) VALUES ($1, $2)
       ON CONFLICT (owner_id) DO UPDATE SET paused = EXCLUDED.paused, updated_at = now()`,
      [owner.userId, profile.coachCadence === 'weekly'],
    );
    await client.query(
      `UPDATE student_memories SET archived_at = now(), updated_at = now()
       WHERE owner_id = $1 AND archived_at IS NULL AND
         (content LIKE 'Primary study goal:%' OR content LIKE 'Preferred focus session length:%' OR content LIKE 'Coaching preference:%')`,
      [owner.userId],
    );
    for (const [index, content] of memories.entries()) {
      await client.query(
        `INSERT INTO student_memories (owner_id, category, content) VALUES ($1, $2, $3)`,
        [owner.userId, index === 0 ? 'goal' : 'preference', content],
      );
    }
    await client.query('COMMIT');
    return { completed: true, profile };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
