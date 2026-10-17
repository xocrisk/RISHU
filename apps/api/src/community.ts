import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { MarketFeed } from "./market/feed.js";

const money = (value: number) => Number(value.toFixed(2));
const userId = (request: FastifyRequest) => request.authUser?.id ?? null;

type Championship = { id: string; title: string; organizer: string; description: string; starts_at: Date; ends_at: Date };

/** Portfolio value (cash + holdings at the latest delayed prices) for the given users. */
async function portfolioValues(pool: Pool, market: MarketFeed, users: string[]): Promise<Map<string, number>> {
  if (!users.length) return new Map();
  const prices = new Map((await market.list()).map((quote) => [quote.symbol, quote.price]));
  const rows = await pool.query<{ user_id: string; cash: string; symbol: string | null; quantity: number | null; average_cost: string | null }>(
    `SELECT p.user_id, p.cash, h.symbol, h.quantity, h.average_cost
     FROM practice_portfolios p LEFT JOIN practice_holdings h ON h.user_id = p.user_id
     WHERE p.user_id = ANY($1::uuid[])`,
    [users],
  );
  const values = new Map<string, number>();
  for (const row of rows.rows) {
    const current = values.get(row.user_id) ?? Number(row.cash);
    const holding = row.symbol && row.quantity ? row.quantity * (prices.get(row.symbol) ?? Number(row.average_cost)) : 0;
    values.set(row.user_id, current + holding);
  }
  return values;
}

/** True while the user is in a championship that is currently running. */
export async function inRunningChampionship(pool: Pool, user: string): Promise<string | null> {
  const result = await pool.query<{ title: string }>(
    `SELECT c.title FROM championship_participants cp JOIN championships c ON c.id = cp.championship_id
     WHERE cp.user_id = $1 AND now() BETWEEN c.starts_at AND c.ends_at LIMIT 1`,
    [user],
  );
  return result.rows[0]?.title ?? null;
}

export async function registerCommunityRoutes(app: FastifyInstance, pool: Pool, market: MarketFeed): Promise<void> {
  /* -------------------------------------------------------------- championship */

  app.get("/v1/championships", async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    const championships = await pool.query<Championship>(
      "SELECT id, title, organizer, description, starts_at, ends_at FROM championships ORDER BY starts_at DESC",
    );
    const participants = await pool.query<{ championship_id: string; user_id: string; start_value: string; joined_at: Date; full_name: string | null; uid: string }>(
      `SELECT cp.championship_id, cp.user_id, cp.start_value, cp.joined_at, u.full_name, u.uid
       FROM championship_participants cp JOIN users u ON u.id = cp.user_id
       WHERE u.deletion_requested_at IS NULL`,
    );
    const values = await portfolioValues(pool, market, [...new Set(participants.rows.map((row) => row.user_id))]);
    const now = Date.now();
    return {
      championships: championships.rows.map((championship) => {
        const entrants = participants.rows.filter((row) => row.championship_id === championship.id);
        const ranked = entrants.map((row) => {
          const value = values.get(row.user_id) ?? Number(row.start_value);
          const start = Number(row.start_value);
          return {
            userId: row.user_id, displayName: row.full_name?.trim() || "XOCRISK trader", uid: row.uid,
            joinedAt: row.joined_at, value: money(value), returnPercent: money(((value - start) / start) * 100),
          };
        }).sort((a, b) => b.returnPercent - a.returnPercent || a.joinedAt.getTime() - b.joinedAt.getTime())
          .map((entry, index) => ({ ...entry, rank: index + 1 }));
        const self = ranked.find((entry) => entry.userId === id) ?? null;
        const status = now < championship.starts_at.getTime() ? "upcoming" : now > championship.ends_at.getTime() ? "ended" : "live";
        const strip = ({ userId: participant, ...entry }: (typeof ranked)[number]) => ({ ...entry, isSelf: participant === id });
        return {
          id: championship.id, title: championship.title, organizer: championship.organizer, description: championship.description,
          startsAt: championship.starts_at, endsAt: championship.ends_at, status,
          participantCount: ranked.length,
          joined: Boolean(self),
          you: self ? strip(self) : null,
          leaderboard: ranked.slice(0, 50).map(strip),
        };
      }),
    };
  });

  app.post<{ Params: { id: string } }>("/v1/championships/:id/join", async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    const championship = await pool.query<Championship>("SELECT id, title, ends_at FROM championships WHERE id = $1", [request.params.id]);
    const row = championship.rows[0];
    if (!row) return reply.code(404).send({ message: "That championship doesn't exist." });
    if (row.ends_at.getTime() < Date.now()) return reply.code(400).send({ message: "This championship has already ended." });
    await pool.query("INSERT INTO practice_portfolios (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [id]);
    const value = (await portfolioValues(pool, market, [id])).get(id) ?? 100000;
    const inserted = await pool.query(
      `INSERT INTO championship_participants (championship_id, user_id, start_value) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING user_id`,
      [row.id, id, money(value)],
    );
    if (!inserted.rowCount) return reply.code(409).send({ message: "You've already joined this championship." });
    return reply.code(201).send({ message: `You're in! Your ${row.title} return is measured from your current account value.` });
  });

  /* -------------------------------------------------------------- community chat */

  type MessageRow = { id: string; body: string; created_at: Date; user_id: string; full_name: string | null; uid: string };
  const toMessage = (row: MessageRow, viewer: string) => ({
    id: Number(row.id), body: row.body, createdAt: row.created_at,
    author: { name: row.full_name?.trim() || "XOCRISK trader", uid: row.uid }, isSelf: row.user_id === viewer,
  });

  app.get<{ Querystring: { after?: string } }>("/v1/community/messages", async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    const after = Number(request.query.after ?? 0);
    const result = Number.isInteger(after) && after > 0
      ? await pool.query<MessageRow>(
        `SELECT m.id, m.body, m.created_at, m.user_id, u.full_name, u.uid FROM community_messages m JOIN users u ON u.id = m.user_id
         WHERE m.id > $1 ORDER BY m.id LIMIT 100`, [after])
      : await pool.query<MessageRow>(
        `SELECT * FROM (SELECT m.id, m.body, m.created_at, m.user_id, u.full_name, u.uid FROM community_messages m JOIN users u ON u.id = m.user_id
         ORDER BY m.id DESC LIMIT 60) latest ORDER BY id`);
    const online = await pool.query<{ count: string }>(
      "SELECT count(DISTINCT user_id)::text AS count FROM auth_sessions WHERE expires_at > now() AND created_at > now() - interval '1 day'",
    );
    return { messages: result.rows.map((row) => toMessage(row, id)), activeToday: Number(online.rows[0]?.count ?? 0) };
  });

  app.post<{ Body: { body: string } }>("/v1/community/messages", {
    schema: { body: { type: "object", additionalProperties: false, required: ["body"], properties: { body: { type: "string", minLength: 1, maxLength: 500 } } } },
  }, async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    const body = request.body.body.trim().replace(/\n{3,}/g, "\n\n");
    if (!body) return reply.code(400).send({ message: "Write a message first." });
    const recent = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM community_messages WHERE user_id = $1 AND created_at > now() - interval '30 seconds'", [id],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 5) return reply.code(429).send({ message: "You're sending messages too quickly. Wait a few seconds." });
    const inserted = await pool.query<MessageRow>(
      `WITH m AS (INSERT INTO community_messages (user_id, body) VALUES ($1, $2) RETURNING id, body, created_at, user_id)
       SELECT m.id, m.body, m.created_at, m.user_id, u.full_name, u.uid FROM m JOIN users u ON u.id = m.user_id`,
      [id, body],
    );
    return reply.code(201).send({ message: toMessage(inserted.rows[0]!, id) });
  });

  app.delete<{ Params: { id: string } }>("/v1/community/messages/:id", async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    const messageId = Number(request.params.id);
    if (!Number.isInteger(messageId) || messageId < 1) return reply.code(400).send({ message: "Enter a valid message ID." });
    const result = await pool.query("DELETE FROM community_messages WHERE id = $1 AND user_id = $2", [messageId, id]);
    if (!result.rowCount) return reply.code(404).send({ message: "You can only delete your own messages." });
    return { message: "Message deleted." };
  });

  /* -------------------------------------------------------------- notes */

  type NoteRow = { id: string; title: string; body: string; created_at: Date; updated_at: Date };
  const toNote = (row: NoteRow) => ({ id: row.id, title: row.title, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at });
  const noteSchema = {
    body: {
      type: "object", additionalProperties: false,
      properties: { title: { type: "string", maxLength: 120 }, body: { type: "string", maxLength: 10000 } },
    },
  } as const;
  const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

  app.get("/v1/notes", async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    const result = await pool.query<NoteRow>(
      "SELECT id, title, body, created_at, updated_at FROM user_notes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200", [id],
    );
    return { notes: result.rows.map(toNote) };
  });

  app.post<{ Body: { title?: string; body?: string } }>("/v1/notes", { schema: noteSchema }, async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    const count = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM user_notes WHERE user_id = $1", [id]);
    if (Number(count.rows[0]?.count ?? 0) >= 200) return reply.code(400).send({ message: "You can keep up to 200 notes. Delete some to add more." });
    const result = await pool.query<NoteRow>(
      "INSERT INTO user_notes (user_id, title, body) VALUES ($1, $2, $3) RETURNING id, title, body, created_at, updated_at",
      [id, request.body.title?.trim() ?? "", request.body.body ?? ""],
    );
    return reply.code(201).send({ note: toNote(result.rows[0]!) });
  });

  app.put<{ Params: { id: string }; Body: { title?: string; body?: string } }>("/v1/notes/:id", { schema: noteSchema }, async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    if (!isUuid(request.params.id)) return reply.code(400).send({ message: "Enter a valid note ID." });
    const result = await pool.query<NoteRow>(
      `UPDATE user_notes SET title = COALESCE($3, title), body = COALESCE($4, body), updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING id, title, body, created_at, updated_at`,
      [request.params.id, id, request.body.title?.trim() ?? null, request.body.body ?? null],
    );
    if (!result.rowCount) return reply.code(404).send({ message: "Note not found." });
    return { note: toNote(result.rows[0]!) };
  });

  app.delete<{ Params: { id: string } }>("/v1/notes/:id", async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    if (!isUuid(request.params.id)) return reply.code(400).send({ message: "Enter a valid note ID." });
    const result = await pool.query("DELETE FROM user_notes WHERE id = $1 AND user_id = $2", [request.params.id, id]);
    if (!result.rowCount) return reply.code(404).send({ message: "Note not found." });
    return { message: "Note deleted." };
  });
}
