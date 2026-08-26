export async function requireAdmin() {
  const session = await getSession();
  if (!session?.user?.isAdmin) throw new Error("forbidden");
  return session;
}

export async function getSession() {
  return { user: { isAdmin: false } };
}
