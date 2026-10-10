import type { NextRequest } from 'next/server';
import { reconcileCalendarOperation } from '@/lib/calendar-route';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return reconcileCalendarOperation(request, (await context.params).id);
}
