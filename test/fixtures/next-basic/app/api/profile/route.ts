export async function GET() {
  const session = await auth();
  return Response.json({ userId: session.user.id });
}

export async function PATCH() {
  await auth();
  await db.users.update({ where: { id: "1" }, data: { name: "A" } });
  return Response.json({ ok: true });
}
