export const actions = {
  removeUser: async () => {
    await db.users.delete({ where: { id: "1" } });
    return { success: true };
  },
  safeRemove: async () => {
    await requireAdmin();
    await db.users.delete({ where: { id: "2" } });
    return { success: true };
  },
};
