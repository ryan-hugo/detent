export async function DELETE() {
  await db.users.delete({ where: { id: "1" } });
  return Response.json({ ok: true });
}
