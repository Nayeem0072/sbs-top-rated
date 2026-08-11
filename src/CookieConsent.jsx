import { useEffect, useState } from "react";
import { loadGA } from "./analytics.js";

const STORAGE_KEY = "cookie-consent";

function readChoice() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export default function CookieConsent() {
  const [choice, setChoice] = useState(readChoice);

  // Load analytics as soon as consent is (or has previously been) granted.
  useEffect(() => {
    if (choice === "accepted") loadGA();
  }, [choice]);

  if (choice === "accepted" || choice === "declined") return null;

  const decide = (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore storage failures (private mode etc.) */
    }
    setChoice(value);
  };

  return (
    <div className="cookie-banner" role="dialog" aria-live="polite" aria-label="Cookie consent">
      <p className="cookie-text">
        This site uses Google Analytics to understand visitor traffic. Analytics cookies are set
        only if you accept.
      </p>
      <div className="cookie-actions">
        <button className="cookie-btn cookie-btn--ghost" onClick={() => decide("declined")}>
          Decline
        </button>
        <button className="cookie-btn cookie-btn--primary" onClick={() => decide("accepted")}>
          Accept
        </button>
      </div>
    </div>
  );
}
