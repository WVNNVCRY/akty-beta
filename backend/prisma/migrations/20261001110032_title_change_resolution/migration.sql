/*
  Warnings:

  - You are about to drop the column `afterApproval` on the `title_changes` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "title_changes" DROP COLUMN "afterApproval",
ADD COLUMN     "duringApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resolvedAt" TIMESTAMP(3);
