export async function DELETE() {
  await db.records.delete({ where: { id: "1" } });
  await requireAdmin();
  return Response.json({ ok: true });
}
