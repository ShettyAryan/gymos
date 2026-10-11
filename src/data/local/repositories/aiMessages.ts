import { nowIso } from '@/utils/clock';
import { newId } from '@/utils/id';

import type { SqlDb } from '../db';

/** Local-only AI conversation history (never synced; deletable any time). */
export type AiMessage = {
  id: string;
  role: 'user' | 'assistant';
  task: string;
  content: string;
  model: string | null;
  prompt_version: string | null;
  created_at: string;
};

export async function listMessages(db: SqlDb, limit = 40): Promise<AiMessage[]> {
  const rows = await db.all<AiMessage>(
    'SELECT * FROM ai_message ORDER BY created_at DESC, rowid DESC LIMIT ?',
    [limit],
  );
  return rows.reverse();
}

export async function addMessage(
  db: SqlDb,
  m: Omit<AiMessage, 'id' | 'created_at'>,
): Promise<void> {
  await db.run(
    'INSERT INTO ai_message (id, role, task, content, model, prompt_version, created_at) VALUES (?,?,?,?,?,?,?)',
    [newId(), m.role, m.task, m.content, m.model, m.prompt_version, nowIso()],
  );
}

export async function clearMessages(db: SqlDb): Promise<void> {
  await db.run('DELETE FROM ai_message');
}
