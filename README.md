# Tree Master

**Tree Master** is a Shopify app that gives merchants full control over their store's navigation menus. The default Shopify admin provides a basic menu editor — Tree Master extends that with drafts, version history, badges, custom-coded menus, and more.

## Why Tree Master?

Shopify's built-in menu editor is limited. Changes go live immediately with no undo, there's no way to save a draft, and you can't add labels like "New" or "Sale" to menu items. Tree Master solves all of that.

## Features

- **Menu Editor** — View and edit your Shopify navigation menus with a visual tree structure. Drag, reorder, and update items without touching code.
- **Draft & Deploy** — Save menu changes as drafts and deploy them when you're ready. Never push unfinished changes live by accident.
- **Version History** — Every deploy creates a snapshot. Restore any previous version of a menu with one click.
- **Custom Menus** — Build fully custom menus using HTML & CSS. Mega menus, sidebar navigation, dropdowns — anything the theme allows.
- **Badges** — Attach labels like "New", "Sale", or "Hot" to menu items. Badges are injected into the theme automatically via the app embed.
- **Scheduled Deploys** — Set a date and time for a menu to go live. Useful for seasonal promotions or planned site updates.
- **Import / Export** — Export your menus as JSON for backup or to transfer them to another store.
- **Menu Health** — Automatically detect common issues: empty menus, items without URLs, items without titles.

## How It Works

Tree Master connects to your Shopify store via OAuth and reads your navigation menus through the Shopify Admin API. Changes are saved as drafts in the app's database and deployed back to Shopify only when you explicitly trigger a deploy. The app embed (installed via the Shopify Theme Editor) handles badge rendering on the storefront.

## Links

- App: [treemaster.app](https://treemaster.app)
- Landing page: [landing.treemaster.app](https://landing.treemaster.app)
