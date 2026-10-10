import type { NextRequest } from 'next/server';
import { connectMoodle, disconnectMoodle, moodleStatus } from '@/lib/moodle';

export const runtime = 'nodejs';
export function GET(request: NextRequest) { return moodleStatus(request); }
export function POST(request: NextRequest) { return connectMoodle(request); }
export function DELETE(request: NextRequest) { return disconnectMoodle(request); }
