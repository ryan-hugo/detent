import { guards } from "@/lib/guards";

export async function PATCH() {
  await guards.exigirGestor();
  await db.faturas.update({ where: { id: "1" }, data: {} });
  return Response.json({ ok: true });
}
