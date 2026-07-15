"use client";

type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
    gtag?: (command: "event", eventName: string, properties?: AnalyticsProperties) => void;
    plausible?: (eventName: string, options?: { props?: AnalyticsProperties }) => void;
  }
}

export function trackEvent(eventName: string, properties: AnalyticsProperties = {}) {
  if (typeof window === "undefined") return;

  const cleanProperties = Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  );

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: eventName,
    ...cleanProperties,
  });
  window.gtag?.("event", eventName, cleanProperties);
  window.plausible?.(eventName, { props: cleanProperties });
}
