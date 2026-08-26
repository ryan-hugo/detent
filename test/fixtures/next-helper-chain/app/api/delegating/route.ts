import { performDelete } from "@/lib/handlers";

export async function DELETE() {
  await performDelete();
  return Response.json({ ok: true });
}
