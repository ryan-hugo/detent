'use server';

export async function adminDeleteEverything() {
  await db.users.delete({ where: {} });
}
