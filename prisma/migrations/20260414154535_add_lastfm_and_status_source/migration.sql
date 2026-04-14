-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "statusSource" TEXT NOT NULL DEFAULT 'calendar';
ALTER TABLE "Settings" ADD COLUMN "lastfmUsername" TEXT;
ALTER TABLE "Settings" ADD COLUMN "musicEmoji" TEXT NOT NULL DEFAULT '🎵';
