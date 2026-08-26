import { withAdmin } from "@/lib/guard";

export const DELETE = withAdmin(async () => {
  await db.reports.delete({ where: { id: "1" } });
  return Response.json({ ok: true });
});
