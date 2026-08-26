export async function POST() {
  await checkAdminBanner();
  await db.reports.create({ data: {} });
  return Response.json({ ok: true });
}
