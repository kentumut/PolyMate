import type { Course } from '@polymate/contracts/courses';
import type { OwnerContext } from '@polymate/core/identity';
import { getPool } from './connection';
import { ensureUser } from './google-oauth';

type Row = {
  id: string; name: string; exercise_session_count: number; lecture_hours_per_week: string | number;
  exercise_session_minutes: number; exam_date: string | Date; must_solve: string[]; optional_solve: string[];
  not_required: string[]; version: number;
};
const columns = 'id, name, exercise_session_count, lecture_hours_per_week, exercise_session_minutes, exam_date, must_solve, optional_solve, not_required, version';

export class CourseConflict extends Error {
  constructor(message = 'This course changed or another course already uses that name. Refresh and try again.') { super(message); this.name = 'CourseConflict'; }
}

function fromRow(row: Row): Course {
  const examDate = row.exam_date instanceof Date ? row.exam_date.toISOString().slice(0, 10) : row.exam_date;
  return { id: row.id, name: row.name, exerciseSessionCount: row.exercise_session_count,
    lectureHoursPerWeek: Number(row.lecture_hours_per_week), exerciseSessionMinutes: row.exercise_session_minutes,
    examDate, examPrep: { must: row.must_solve, optional: row.optional_solve, not_required: row.not_required }, version: row.version };
}

export async function listCourses(ownerId: string): Promise<Course[]> {
  const result = await getPool().query<Row>(`SELECT ${columns} FROM courses WHERE owner_id = $1 ORDER BY exam_date, lower(name), id`, [ownerId]);
  return result.rows.map(fromRow);
}

export async function saveCourse(owner: OwnerContext, course: Course): Promise<Course> {
  await ensureUser(owner);
  try {
    if (course.version === 0) {
      const inserted = await getPool().query<Row>(
        `INSERT INTO courses (id, owner_id, name, exercise_session_count, lecture_hours_per_week, exercise_session_minutes, exam_date, must_solve, optional_solve, not_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${columns}`,
        [course.id, owner.userId, course.name, course.exerciseSessionCount, course.lectureHoursPerWeek, course.exerciseSessionMinutes, course.examDate,
          course.examPrep.must, course.examPrep.optional, course.examPrep.not_required],
      );
      return fromRow(inserted.rows[0]);
    }
    const updated = await getPool().query<Row>(
      `UPDATE courses SET name=$4, exercise_session_count=$5, lecture_hours_per_week=$6, exercise_session_minutes=$7, exam_date=$8,
         must_solve=$9, optional_solve=$10, not_required=$11, version=version+1, updated_at=now()
       WHERE owner_id=$1 AND id=$2 AND version=$3 RETURNING ${columns}`,
      [owner.userId, course.id, course.version, course.name, course.exerciseSessionCount, course.lectureHoursPerWeek,
        course.exerciseSessionMinutes, course.examDate, course.examPrep.must, course.examPrep.optional, course.examPrep.not_required],
    );
    if (!updated.rows[0]) throw new CourseConflict();
    return fromRow(updated.rows[0]);
  } catch (error) {
    if (error instanceof CourseConflict) throw error;
    if ((error as { code?: string }).code === '23505') throw new CourseConflict();
    throw error;
  }
}

export async function deleteCourse(ownerId: string, id: string, expectedVersion: number): Promise<void> {
  const result = await getPool().query(`DELETE FROM courses WHERE owner_id=$1 AND id=$2 AND version=$3`, [ownerId, id, expectedVersion]);
  if (!result.rowCount) throw new CourseConflict('This course changed or was already removed. Refresh and try again.');
}
