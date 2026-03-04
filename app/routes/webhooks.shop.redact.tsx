import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR compliance webhook
// Shopify sends this 48 hours after a shop uninstalls the app
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Delete all shop data from the database
  await db.session.deleteMany({ where: { shop } });
  await db.menuMeta.deleteMany({ where: { shop } });
  await db.customMenu.deleteMany({ where: { shop } });
  await db.menuSnapshot.deleteMany({ where: { shop } });
  await db.scheduledDeploy.deleteMany({ where: { shop } });
  await db.webhookConfig.deleteMany({ where: { shop } });

  return new Response();
};
