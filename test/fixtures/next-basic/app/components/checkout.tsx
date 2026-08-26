'use client';

export function Checkout() {
  const leaked = process.env.STRIPE_SECRET_KEY;
  const publicSecret = process.env.NEXT_PUBLIC_INTERNAL_TOKEN;
  return <div>{Boolean(leaked || publicSecret)}</div>;
}
