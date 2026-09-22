import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AUTH_APPEARANCE, AuthFrame } from "@/components/auth-frame";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthFrame
      title="Sign in to Cira"
      subtitle="Your company's software, and the assistants that use it, in one place."
    >
      <SignIn appearance={AUTH_APPEARANCE} />
    </AuthFrame>
  );
}
