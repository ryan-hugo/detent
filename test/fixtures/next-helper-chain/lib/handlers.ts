export async function performDelete() {
  await requireAdmin();
  await db.records.delete({ where: { id: "1" } });
}
