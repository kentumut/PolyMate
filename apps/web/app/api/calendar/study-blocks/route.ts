import { parseDialogCreateRequest } from '@polymate/contracts/calendar';
import type { NextRequest } from 'next/server';
import { calendarMutation } from '@/lib/calendar-route';

export function POST(request: NextRequest) {
  return calendarMutation(request, parseDialogCreateRequest,
    (service, { block, operationId }) => service.createStudyBlock(block, operationId));
}
