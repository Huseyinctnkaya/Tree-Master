# Tree Master

A Shopify app for managing your store's navigation menus.

## Features

- **Menu Editor** — View, edit, and organize your Shopify navigation menus with a visual tree structure
- **Draft & Deploy** — Save menu changes as drafts before pushing them live to your store
- **Version History** — Keep snapshots of your menus and restore previous versions anytime
- **Custom Menus** — Build menus with custom HTML & CSS (mega menus, sidebars, etc.)
- **Badges** — Add labels/badges to menu items (e.g. "New", "Sale") via theme integration
- **Scheduled Deploys** — Schedule menu changes to go live at a specific time
- **Import / Export** — Backup menus or transfer them between stores
- **Menu Health** — Detect issues like empty menus, missing URLs, or untitled items

## Tech Stack

- [Remix](https://remix.run) + [Shopify App Remix](https://shopify.dev/docs/api/shopify-app-remix)
- [Prisma](https://www.prisma.io) with SQLite
- [Shopify Polaris](https://polaris.shopify.com) for UI
- Deployed on IONOS VPS with PM2 + Nginx

## Development

```bash
npm install
npm run dev
```

## Production

The app runs at [treemaster.app](https://treemaster.app) on port 3002 behind Nginx with SSL.
