async function handler() {
  await requireAdmin();
  return Response.json({ ok: true });
}

export { handler as GET, handler as DELETE };
