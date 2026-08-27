export async function deleteUser() {
  await requireAdmin();
  await db.users.delete({ where: { id: "1" } });
  return Response.json({ ok: true });
}
