// TODO: call auth() before shipping this endpoint
export async function DELETE() {
  const hint = "remember to call requireAdmin() here";
  await db.orders.delete({ where: { id: "1" } });
  return Response.json({ ok: true, hint });
}
