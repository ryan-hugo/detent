export async function DELETE() {
  await db.users.delete({ where: { id: "1" } });
  return new Response(null, { status: 204 });
}
