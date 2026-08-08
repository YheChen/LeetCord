-- CreateTable
CREATE TABLE "UserLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discordUserId" TEXT NOT NULL,
    "leetcodeUsername" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "completionFeedMentionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "verificationCode" TEXT,
    "verificationExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GuildSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "dailyChannelId" TEXT,
    "timezone" TEXT,
    "leaderboardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GuildMemberLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userLinkId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuildMemberLink_userLinkId_fkey" FOREIGN KEY ("userLinkId") REFERENCES "UserLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserStatsSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userLinkId" TEXT NOT NULL,
    "totalSolved" INTEGER NOT NULL,
    "easySolved" INTEGER NOT NULL,
    "mediumSolved" INTEGER NOT NULL,
    "hardSolved" INTEGER NOT NULL,
    "streakCount" INTEGER,
    "contestRating" REAL,
    "lastSubmissionAt" DATETIME,
    "fetchedAt" DATETIME NOT NULL,
    CONSTRAINT "UserStatsSnapshot_userLinkId_fkey" FOREIGN KEY ("userLinkId") REFERENCES "UserLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyProblem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DailyCompletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userLinkId" TEXT NOT NULL,
    "dailyProblemId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "detectedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    CONSTRAINT "DailyCompletion_userLinkId_fkey" FOREIGN KEY ("userLinkId") REFERENCES "UserLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyCompletion_dailyProblemId_fkey" FOREIGN KEY ("dailyProblemId") REFERENCES "DailyProblem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GuildDailyPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "dailyProblemId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "postedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuildDailyPost_dailyProblemId_fkey" FOREIGN KEY ("dailyProblemId") REFERENCES "DailyProblem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyLeaderboardSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "weekStart" DATETIME NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "UserLink_discordUserId_key" ON "UserLink"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "GuildSettings_guildId_key" ON "GuildSettings"("guildId");

-- CreateIndex
CREATE INDEX "GuildMemberLink_guildId_idx" ON "GuildMemberLink"("guildId");

-- CreateIndex
CREATE INDEX "GuildMemberLink_userLinkId_idx" ON "GuildMemberLink"("userLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "GuildMemberLink_guildId_userLinkId_key" ON "GuildMemberLink"("guildId", "userLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyProblem_date_key" ON "DailyProblem"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyProblem_slug_key" ON "DailyProblem"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCompletion_userLinkId_dailyProblemId_key" ON "DailyCompletion"("userLinkId", "dailyProblemId");

-- CreateIndex
CREATE INDEX "WeeklyLeaderboardSnapshot_guildId_weekStart_idx" ON "WeeklyLeaderboardSnapshot"("guildId", "weekStart");
