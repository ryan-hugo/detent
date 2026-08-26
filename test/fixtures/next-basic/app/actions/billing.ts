'use server';

export async function refundPayment() {
  await stripe.refunds.create({ payment_intent: "pi_123" });
}

export async function adminRefundPayment() {
  await requireAdmin();
  await stripe.refunds.create({ payment_intent: "pi_456" });
}
