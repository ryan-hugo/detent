export const POST = (
  async () => {
    await db.records.create({ data: {} });
    return Response.json({ ok: true });
  },
);
