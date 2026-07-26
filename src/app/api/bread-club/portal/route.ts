import { NextResponse } from "next/server";
import { getBreadClubSessionMembershipId } from "@/lib/bread-club/auth";
import { getBreadClubPortalConfigurationId } from "@/lib/bread-club/config";
import { getBreadClubMemberData } from "@/lib/bread-club/member-data";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getSiteUrl } from "@/lib/utils";

async function getPortalConfigurationId() {
  const configured = getBreadClubPortalConfigurationId();
  if (configured) return configured;
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("bread_club_settings")
    .select("stripe_portal_configuration_id")
    .eq("id", true)
    .maybeSingle();
  return data?.stripe_portal_configuration_id
    ? String(data.stripe_portal_configuration_id)
    : null;
}

export async function POST() {
  const membershipId = await getBreadClubSessionMembershipId();
  if (!membershipId) {
    return NextResponse.json(
      { error: "Use a secure email link to access billing." },
      { status: 401 },
    );
  }
  const member = await getBreadClubMemberData(membershipId);
  if (!member?.stripeCustomerId) {
    return NextResponse.json(
      { error: "Stripe billing is not connected for this membership." },
      { status: 409 },
    );
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe billing is not configured." },
      { status: 503 },
    );
  }

  const configurationId = await getPortalConfigurationId();
  const session = await stripe.billingPortal.sessions.create({
    customer: member.stripeCustomerId,
    configuration: configurationId || undefined,
    return_url: `${getSiteUrl()}/bread-club/manage`,
  });
  return NextResponse.json({ url: session.url });
}
