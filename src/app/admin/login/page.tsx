import Link from "next/link";
import { AdminLoginForm } from "@/components/admin-login-form";

export const metadata = {
  title: "Admin Login",
};

function getErrorMessage(error?: string, message?: string) {
  if (message) return message;

  if (error === "otp_expired") {
    return "That email link is invalid or expired. Request one fresh link and use the newest email only.";
  }

  if (error === "missing_code") {
    return "The login link was missing its session code. Request a new magic link.";
  }

  if (error === "session_exchange_failed") {
    return "The login session could not be completed. Request a new magic link.";
  }

  return null;
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = getErrorMessage(params.error, params.message);

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
        {errorMessage ? (
          <div className="mt-4 rounded-md border border-[#a94334]/30 bg-[#fffaf2] p-3 text-sm leading-6 text-[#a94334]">
            {errorMessage}
          </div>
        ) : null}
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
