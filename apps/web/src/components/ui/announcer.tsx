"use client";

import { useEffect, useState } from "react";

const EVENT = "cira:announce";

/**
 * Say something aloud from a part of the page that is about to disappear.
 *
 * A `LiveStatus` lives in the component that speaks, which is right almost
 * everywhere - but removing someone takes their row away, status and all, in
 * the same moment it would say "Removed Dana". This hands the words to the
 * one `Announcer` the app shell keeps mounted instead.
 */
export function announce(message: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function Announcer() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const hear = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === "string") {
        setMessage(event.detail);
      }
    };
    window.addEventListener(EVENT, hear);
    return () => window.removeEventListener(EVENT, hear);
  }, []);

  return (
    <span role="status" className="sr-only">
      {message}
    </span>
  );
}
