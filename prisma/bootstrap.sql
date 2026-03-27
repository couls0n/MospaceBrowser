CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "browserConfig" TEXT NOT NULL,
    "fingerprintEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fingerprintOs" TEXT,
    "fingerprintConfig" TEXT,
    "proxyType" TEXT,
    "proxyHost" TEXT,
    "proxyPort" INTEGER,
    "proxyUsername" TEXT,
    "proxyPassword" TEXT,
    "storagePath" TEXT NOT NULL,
    "groupId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "Proxy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "type" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "countryCode" TEXT,
    "latency" INTEGER,
    "lastChecked" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Profile_storagePath_key" ON "Profile"("storagePath");
CREATE INDEX "Profile_createdAt_idx" ON "Profile"("createdAt");
CREATE INDEX "Profile_groupId_idx" ON "Profile"("groupId");
