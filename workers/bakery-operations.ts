export default {
  async scheduled(controller, env) {
    if (!env.CRON_SECRET) {
      throw new Error("Bakery operations cron secret is not configured.");
    }

    const response = await env.STOREFRONT.fetch(
      new Request("https://www.landlsourdough.com/api/cron/bread-club", {
        method: "POST",
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
        signal: AbortSignal.timeout(10 * 60 * 1000),
      }),
    );
    const payload = await response.json<{ ok?: boolean }>().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      console.error(JSON.stringify({
        event: "bakery_operations_failed",
        scheduledTime: controller.scheduledTime,
        status: response.status,
      }));
      throw new Error(`Bakery operations failed with HTTP ${response.status}.`);
    }

    console.log(JSON.stringify({
      event: "bakery_operations_completed",
      scheduledTime: controller.scheduledTime,
      cron: controller.cron,
    }));
  },
} satisfies ExportedHandler<BakeryCronEnv>;
