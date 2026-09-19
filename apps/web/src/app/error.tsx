"use client";

import { ErrorScreen } from "@/components/error-screen";

/** A page that threw, inside Cira's own layout and theme. */
export default function PageError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorScreen {...props} />;
}
