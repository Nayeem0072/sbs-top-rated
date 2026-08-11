// Google Analytics 4 loader. The gtag script is injected only after the visitor
// grants consent (see CookieConsent.jsx), so no analytics cookies are set until
// then. The Measurement ID is not a secret — it's visible in the browser either
// way — so it lives in the client bundle.
export const GA_MEASUREMENT_ID = "G-3T4X6ZQ31E";

let loaded = false;

export function loadGA() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);
}
