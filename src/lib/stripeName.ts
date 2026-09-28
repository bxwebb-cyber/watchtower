import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// The name clients see on the Stripe payment page and receipt: the connected
// account's public business name, falling back to its dashboard display name.
// Null when it can't be read (not connected yet, or Stripe unreachable) — the
// name check then simply doesn't show.
export async function stripePublicName(stripeAccountId: string | null | undefined): Promise<string | null> {
  if (!stripeAccountId || !stripeAccountId.startsWith('acct_')) return null;
  try {
    const acct = await stripe.accounts.retrieve(stripeAccountId);
    return acct.business_profile?.name || acct.settings?.dashboard?.display_name || null;
  } catch (err) {
    console.error('[stripe] could not read the public business name for', stripeAccountId, (err as Error).message);
    return null;
  }
}
