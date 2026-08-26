export async function DELETE() {
  await exigirGestor();
  await enviarCobranca({ id: "1" });
  return Response.json({ ok: true });
}
