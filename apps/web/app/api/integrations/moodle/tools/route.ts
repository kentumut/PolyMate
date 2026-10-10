import type { NextRequest } from 'next/server';
import { ContractError } from '@polymate/contracts/calendar';
import { executeMoodleTool, moodleBody, moodleError } from '@/lib/moodle';

export const runtime = 'nodejs';
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await moodleBody(request);
    if (typeof body.name !== 'string' || !body.arguments || typeof body.arguments !== 'object' || Array.isArray(body.arguments)) {
      throw new ContractError('Provide a tool name and arguments object.');
    }
    const result = await executeMoodleTool(request, body.name, body.arguments as Record<string, unknown>);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return moodleError(error); }
}
