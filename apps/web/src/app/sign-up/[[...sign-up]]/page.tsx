import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { PLANS } from "@cira/core";
import { AUTH_APPEARANCE, AuthFrame } from "@/components/auth-frame";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage() {
  return (
    <AuthFrame
      subtitle={`Your company's space is free for ${PLANS.trial.trialDays} days, with no card. Use your work email, so colleagues at your company can find it.`}
    >
      <SignUp appearance={AUTH_APPEARANCE} />
    </AuthFrame>
  );
}
