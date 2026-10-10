export type ProgressDraftContext = { assignment: number; session: number; etag: string };
/** Keep an open draft's original references until the student explicitly reviews changes. */
export function progressDraftIsStale(expected: ProgressDraftContext, current: ProgressDraftContext) {
  return expected.assignment !== current.assignment || expected.session !== current.session || expected.etag !== current.etag;
}
