"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders its children at the end of the document instead of where they sit in
 * the tree.
 *
 * Required for anything that covers the page, because the header applies a
 * backdrop filter: a filtered element becomes the containing block for every
 * `position: fixed` descendant, so an overlay declared inside the header is
 * silently clipped to the header's own box. A dialog opened from a button in
 * the chrome is exactly that case, and the symptom - a backdrop that dims only
 * the top bar, and a panel centred on the wrong thing - looks like a z-index
 * problem and is not one.
 *
 * Nothing renders on the server, where there is no document to portal into.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
