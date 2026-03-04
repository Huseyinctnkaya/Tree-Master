import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Mandatory GDPR compliance webhook
// Shopify sends this when a customer requests deletion of their data
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Tree Master does not store personal customer data.
  // No action needed beyond acknowledging the request.

  return new Response();
};
