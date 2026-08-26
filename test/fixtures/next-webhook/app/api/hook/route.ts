export async function POST(req: Request) {
  const event = stripe.webhooks.constructEvent(
    await req.text(),
    headers().get("stripe-signature"),
    process.env.STRIPE_WEBHOOK_SECRET,
  );
  await db.orders.update({ where: { id: event.id }, data: {} });
  return Response.json({ received: true });
}
