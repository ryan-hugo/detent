export async function DELETE() {
  await auth();
  await db.users.delete({ where: { id: "1" } });
  return Response.json({ ok: true });
}
