import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

type NoteRow = {
  id: string; title: string; body: string; category: string; illustrations: unknown[];
  version: number; created_at: Date; updated_at: Date;
};
const columns = "id, title, body, category, illustrations, version, created_at, updated_at";
const toNote = (row: NoteRow) => ({
  id: row.id, title: row.title, body: row.body, category: row.category, illustrations: row.illustrations,
  version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
});
const fields = {
  title: { type: "string", minLength: 1, maxLength: 120, pattern: "\\S" },
  body: { type: "string", maxLength: 10000 },
} as const;
const params = { type: "object", required: ["id"], properties: { id: { type: "string", pattern: "^[a-z0-9-]{1,80}$" } } } as const;

/** Shared learning content. Legacy user_notes remain private and are never read here. */
export async function registerNotesRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  async function isAdmin(id: string) {
    const result = await pool.query("SELECT 1 FROM notes_admins WHERE user_id = $1", [id]);
    return Boolean(result.rowCount);
  }
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    if (!request.authUser) return reply.code(401).send({ message: "Sign in to continue." });
    if (!await isAdmin(request.authUser.id)) return reply.code(403).send({ message: "Only admins can change learning notes." });
  }

  app.get("/v1/notes", async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ message: "Sign in to continue." });
    reply.header("Cache-Control", "private, no-store");
    const canEdit = await isAdmin(request.authUser.id);
    const result = await pool.query<NoteRow>(`SELECT ${columns} FROM learning_notes ORDER BY sort_order, title, id`);
    return { notes: result.rows.map(toNote), canEdit };
  });

  app.post<{ Body: { title: string; body: string } }>("/v1/notes", {
    bodyLimit: 64 * 1024,
    preHandler: requireAdmin,
    schema: { body: { type: "object", additionalProperties: false, required: ["title", "body"], properties: fields } },
  }, async (request, reply) => {
    const result = await pool.query<NoteRow>(
      `INSERT INTO learning_notes (title, body, updated_by) VALUES ($1, $2, $3) RETURNING ${columns}`,
      [request.body.title.trim(), request.body.body, request.authUser!.id],
    );
    return reply.code(201).send({ note: toNote(result.rows[0]!) });
  });

  app.put<{ Params: { id: string }; Body: { title: string; body: string; version: number } }>("/v1/notes/:id", {
    bodyLimit: 64 * 1024,
    preHandler: requireAdmin,
    schema: { params, body: { type: "object", additionalProperties: false, required: ["title", "body", "version"],
      properties: { ...fields, version: { type: "integer", minimum: 1 } } } },
  }, async (request, reply) => {
    const result = await pool.query<NoteRow>(
      `UPDATE learning_notes SET title = $2, body = $3, version = version + 1, updated_at = now(), updated_by = $4
       WHERE id = $1 AND version = $5 RETURNING ${columns}`,
      [request.params.id, request.body.title.trim(), request.body.body, request.authUser!.id, request.body.version],
    );
    if (!result.rowCount) return reply.code(409).send({ message: "This note changed or was deleted. Reload notes before editing again." });
    return { note: toNote(result.rows[0]!) };
  });

  app.delete<{ Params: { id: string }; Querystring: { version: number } }>("/v1/notes/:id", {
    preHandler: requireAdmin,
    schema: { params, querystring: { type: "object", required: ["version"], properties: { version: { type: "integer", minimum: 1 } } } },
  }, async (request, reply) => {
    const result = await pool.query("DELETE FROM learning_notes WHERE id = $1 AND version = $2", [request.params.id, request.query.version]);
    if (!result.rowCount) return reply.code(409).send({ message: "This note changed or was deleted. Reload notes before deleting again." });
    return { message: "Note deleted." };
  });
}
