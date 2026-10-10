import type { NextRequest } from 'next/server';
import { readMoodleCalendar } from '@/lib/moodle';

export const runtime = 'nodejs';
export async function GET(request: NextRequest): Promise<Response> { return readMoodleCalendar(request); }
export async function POST(request: NextRequest): Promise<Response> { return readMoodleCalendar(request, true); }
