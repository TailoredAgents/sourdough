import Link from "next/link";
import { AdminLoginForm } from "@/components/admin-login-form";

export const metadata = {
  title: "Admin Login",
};

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffaf2] px-4">
      <div className="w-full max-w-md rounded-md border border-stone-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
          Owner login
        </p>
        <h1 className="mt-3 text-3xl font-bold text-stone-950">
          L&L Sourdough admin
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-700">
          Enter an approved owner email. Supabase will send a magic link to open
          the protected admin workspace.
        </p>
        <AdminLoginForm />
        <Link
          href="/"
          className="mt-6 inline-flex text-sm font-semibold text-stone-700"
        >
          Back to storefront
        </Link>
      </div>
    </main>
  );
}
