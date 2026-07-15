"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics";

function datasetValue(element: HTMLElement, key: string) {
  return element.dataset[key] || undefined;
}

export function AnalyticsEvents() {
  const pathname = usePathname();

  useEffect(() => {
    trackEvent("page_view", {
      path: pathname,
      title: document.title,
    });
  }, [pathname]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const element = target.closest<HTMLElement>("[data-analytics-event]");
      if (!element) return;

      const eventName = datasetValue(element, "analyticsEvent");
      if (!eventName) return;

      trackEvent(eventName, {
        label: datasetValue(element, "analyticsLabel"),
        category: datasetValue(element, "analyticsCategory"),
        product_id: datasetValue(element, "analyticsProductId"),
        product_name: datasetValue(element, "analyticsProductName"),
        section: datasetValue(element, "analyticsSection"),
        href:
          element instanceof HTMLAnchorElement
            ? element.getAttribute("href")
            : undefined,
        path: window.location.pathname,
      });
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}
