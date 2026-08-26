export async function deleteAccount() {
  'use server';
  await db.users.delete({ where: { id: "1" } });
}

export function formatName(first: string, last: string) {
  return `${first} ${last}`;
}
