import { parseDialogCreateRequest } from '@polymate/contracts/calendar';
import type { NextRequest } from 'next/server';
import { calendarMutation } from '@/lib/calendar-route';
import { reserveBlockAssignment } from '@polymate/db/study-progress';

export function POST(request: NextRequest) {
  return calendarMutation(request, parseDialogCreateRequest,
    (service, { block, operationId }) => service.createStudyBlock(block, operationId),
    async (owner, input) => {
      if (input.assignmentId) await reserveBlockAssignment(owner.userId, input.operationId, input.assignmentId, input.expectedAssignmentVersion!);
    });
}
