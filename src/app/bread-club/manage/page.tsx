import type { Metadata } from "next";
import { BreadClubAccessForm } from "@/components/bread-club-access-form";
import { BreadClubMemberDashboard } from "@/components/bread-club-member-dashboard";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getBreadClubSessionMembershipId } from "@/lib/bread-club/auth";
import { getBreadClubCatalogData } from "@/lib/bread-club/data";
import { getBreadClubMemberData } from "@/lib/bread-club/member-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage Sunday Bread Club",
  robots: { index: false, follow: false },
};

export default async function BreadClubManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const membershipId = await getBreadClubSessionMembershipId();
  const [member, catalog] = await Promise.all([
    membershipId
      ? getBreadClubMemberData(membershipId)
      : Promise.resolve(null),
    getBreadClubCatalogData(),
  ]);

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="min-h-[70vh] bg-[#fffaf2] py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {member ? (
            <BreadClubMemberDashboard
              initialMember={member}
              plans={catalog.plans}
            />
          ) : (
            <BreadClubAccessForm
              accessStatus={
                typeof params.access === "string"
                  ? params.access
                  : undefined
              }
            />
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
