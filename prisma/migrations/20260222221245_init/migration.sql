-- CreateTable
CREATE TABLE "MenuSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "menuGid" TEXT NOT NULL,
    "menuHandle" TEXT NOT NULL,
    "menuTitle" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "MenuSnapshot_shop_menuGid_idx" ON "MenuSnapshot"("shop", "menuGid");
