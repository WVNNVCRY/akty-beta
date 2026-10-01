-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('GC', 'MANAGER', 'CONTRACTOR', 'CLIENT');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'WAITING_PARTNER', 'ON_CHECK_CLIENT', 'APPROVED_BY_CLIENT', 'REJECTED_BY_CLIENT', 'REJECTED_BY_GC', 'TITLE_CHANGED');

-- CreateEnum
CREATE TYPE "ActStatus" AS ENUM ('ON_CHECK_CLIENT', 'IN_REVISION', 'ON_CHECK_GC', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('ACTION', 'IMPORTANT', 'REMINDER', 'INFO');

-- CreateEnum
CREATE TYPE "TelegramDelivery" AS ENUM ('NONE', 'PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('SCHEME', 'PHOTO', 'WORD_ACT', 'IMPORT_EXCEL', 'CHAT');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('OBJECT_TITLE', 'EXECUTION_TITLE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PROCESSING', 'NEEDS_RESOLUTION', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('CREATED', 'UPDATED', 'IMPORT_CONFLICT', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ConflictResolution" AS ENUM ('OVERWRITE', 'CREATE_NEW', 'SKIP');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "contractorId" UUID,
    "clientId" UUID,
    "telegramChatId" TEXT,
    "telegramLinkedAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_tokens" (
    "token" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "contractors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marking_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widthM" DECIMAL(6,3) NOT NULL,
    "fillRatio" DECIMAL(5,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marking_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objects" (
    "id" UUID NOT NULL,
    "excelRowNumber" INTEGER,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "titleM2" DECIMAL(12,3) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "titleM2" DECIMAL(12,3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reminderLevel" SMALLINT NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_contractors" (
    "executionId" UUID NOT NULL,
    "contractorId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_contractors_pkey" PRIMARY KEY ("executionId","contractorId")
);

-- CreateTable
CREATE TABLE "title_changes" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "fromM2" DECIMAL(12,3) NOT NULL,
    "toM2" DECIMAL(12,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "afterApproval" BOOLEAN NOT NULL DEFAULT false,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "title_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_forms" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "contractorId" UUID NOT NULL,
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "autoZero" BOOLEAN NOT NULL DEFAULT false,
    "totalM2" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "schemeFileId" UUID,
    "photoFileId" UUID,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_lines" (
    "id" UUID NOT NULL,
    "formId" UUID NOT NULL,
    "markingTypeId" UUID NOT NULL,
    "linearM" DECIMAL(12,3) NOT NULL,
    "widthM" DECIMAL(6,3) NOT NULL,
    "fillRatio" DECIMAL(5,4) NOT NULL,
    "areaM2" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "form_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acts" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "executionId" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "status" "ActStatus" NOT NULL DEFAULT 'ON_CHECK_CLIENT',
    "round" INTEGER NOT NULL DEFAULT 1,
    "totalM2" DECIMAL(12,3) NOT NULL,
    "wordFileId" UUID,
    "wordGeneratedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "act_rows" (
    "id" UUID NOT NULL,
    "actId" UUID NOT NULL,
    "contractorId" UUID NOT NULL,
    "autoZero" BOOLEAN NOT NULL DEFAULT false,
    "totalM2" DECIMAL(12,3) NOT NULL,
    "schemeFileId" UUID,
    "photoFileId" UUID,

    CONSTRAINT "act_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "act_row_lines" (
    "id" UUID NOT NULL,
    "rowId" UUID NOT NULL,
    "markingTypeId" UUID NOT NULL,
    "linearM" DECIMAL(12,3) NOT NULL,
    "widthM" DECIMAL(6,3) NOT NULL,
    "fillRatio" DECIMAL(5,4) NOT NULL,
    "areaM2" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "act_row_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "history_entries" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "hiddenFromClient" BOOLEAN NOT NULL DEFAULT false,
    "visibleToContractorId" UUID,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,
    "executionId" UUID,
    "formId" UUID,
    "actId" UUID,

    CONSTRAINT "history_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "kind" "FileKind" NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" TEXT,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "userId" UUID,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_read_marks" (
    "userId" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_read_marks_pkey" PRIMARY KEY ("userId","objectId")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "objectId" UUID,
    "executionId" UUID,
    "actId" UUID,
    "dedupeKey" TEXT,
    "telegram" "TelegramDelivery" NOT NULL DEFAULT 'NONE',
    "telegramSentAt" TIMESTAMP(3),
    "telegramError" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_logs" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PROCESSING',
    "fileName" TEXT NOT NULL,
    "fileId" UUID,
    "uploadedById" UUID,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsCreated" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsConflict" INTEGER NOT NULL DEFAULT 0,
    "rowsError" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "rawData" JSONB NOT NULL,
    "objectId" UUID,
    "executionId" UUID,
    "resolution" "ConflictResolution",
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "remindFirstDays" INTEGER NOT NULL DEFAULT 2,
    "remindSecondDays" INTEGER NOT NULL DEFAULT 5,
    "toleranceM2" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "actCounter" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_key" ON "users"("login");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramChatId_key" ON "users"("telegramChatId");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_contractorId_idx" ON "users"("contractorId");

-- CreateIndex
CREATE INDEX "users_clientId_idx" ON "users"("clientId");

-- CreateIndex
CREATE INDEX "telegram_link_tokens_userId_idx" ON "telegram_link_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "contractors_name_key" ON "contractors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_name_key" ON "clients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "marking_types_code_key" ON "marking_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "objects_excelRowNumber_key" ON "objects"("excelRowNumber");

-- CreateIndex
CREATE INDEX "objects_clientId_idx" ON "objects"("clientId");

-- CreateIndex
CREATE INDEX "objects_district_idx" ON "objects"("district");

-- CreateIndex
CREATE INDEX "executions_lastActivityAt_idx" ON "executions"("lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "executions_objectId_number_key" ON "executions"("objectId", "number");

-- CreateIndex
CREATE INDEX "execution_contractors_contractorId_idx" ON "execution_contractors"("contractorId");

-- CreateIndex
CREATE INDEX "title_changes_executionId_createdAt_idx" ON "title_changes"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "contractor_forms_contractorId_status_idx" ON "contractor_forms"("contractorId", "status");

-- CreateIndex
CREATE INDEX "contractor_forms_status_idx" ON "contractor_forms"("status");

-- CreateIndex
CREATE UNIQUE INDEX "contractor_forms_executionId_contractorId_key" ON "contractor_forms"("executionId", "contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "form_lines_formId_markingTypeId_key" ON "form_lines"("formId", "markingTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "acts_number_key" ON "acts"("number");

-- CreateIndex
CREATE UNIQUE INDEX "acts_executionId_key" ON "acts"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "acts_wordFileId_key" ON "acts"("wordFileId");

-- CreateIndex
CREATE INDEX "acts_status_idx" ON "acts"("status");

-- CreateIndex
CREATE INDEX "acts_objectId_idx" ON "acts"("objectId");

-- CreateIndex
CREATE INDEX "acts_archivedAt_idx" ON "acts"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "act_rows_actId_contractorId_key" ON "act_rows"("actId", "contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "act_row_lines_rowId_markingTypeId_key" ON "act_row_lines"("rowId", "markingTypeId");

-- CreateIndex
CREATE INDEX "history_entries_executionId_createdAt_idx" ON "history_entries"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "history_entries_formId_createdAt_idx" ON "history_entries"("formId", "createdAt");

-- CreateIndex
CREATE INDEX "history_entries_actId_createdAt_idx" ON "history_entries"("actId", "createdAt");

-- CreateIndex
CREATE INDEX "stored_files_uploadedById_idx" ON "stored_files"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_bucket_key_key" ON "stored_files"("bucket", "key");

-- CreateIndex
CREATE INDEX "chat_messages_objectId_createdAt_idx" ON "chat_messages"("objectId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_userId_kind_createdAt_idx" ON "notifications"("userId", "kind", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_userId_objectId_idx" ON "notifications"("userId", "objectId");

-- CreateIndex
CREATE INDEX "notifications_telegram_idx" ON "notifications"("telegram");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "import_logs_startedAt_idx" ON "import_logs"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "import_rows_importId_status_idx" ON "import_rows"("importId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_importId_rowNumber_key" ON "import_rows"("importId", "rowNumber");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_contractors" ADD CONSTRAINT "execution_contractors_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_contractors" ADD CONSTRAINT "execution_contractors_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_changes" ADD CONSTRAINT "title_changes_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "title_changes" ADD CONSTRAINT "title_changes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_forms" ADD CONSTRAINT "contractor_forms_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_forms" ADD CONSTRAINT "contractor_forms_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_forms" ADD CONSTRAINT "contractor_forms_schemeFileId_fkey" FOREIGN KEY ("schemeFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_forms" ADD CONSTRAINT "contractor_forms_photoFileId_fkey" FOREIGN KEY ("photoFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_lines" ADD CONSTRAINT "form_lines_formId_fkey" FOREIGN KEY ("formId") REFERENCES "contractor_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_lines" ADD CONSTRAINT "form_lines_markingTypeId_fkey" FOREIGN KEY ("markingTypeId") REFERENCES "marking_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acts" ADD CONSTRAINT "acts_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acts" ADD CONSTRAINT "acts_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acts" ADD CONSTRAINT "acts_wordFileId_fkey" FOREIGN KEY ("wordFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_rows" ADD CONSTRAINT "act_rows_actId_fkey" FOREIGN KEY ("actId") REFERENCES "acts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_rows" ADD CONSTRAINT "act_rows_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_rows" ADD CONSTRAINT "act_rows_schemeFileId_fkey" FOREIGN KEY ("schemeFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_rows" ADD CONSTRAINT "act_rows_photoFileId_fkey" FOREIGN KEY ("photoFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_row_lines" ADD CONSTRAINT "act_row_lines_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "act_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "act_row_lines" ADD CONSTRAINT "act_row_lines_markingTypeId_fkey" FOREIGN KEY ("markingTypeId") REFERENCES "marking_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "history_entries" ADD CONSTRAINT "history_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "history_entries" ADD CONSTRAINT "history_entries_visibleToContractorId_fkey" FOREIGN KEY ("visibleToContractorId") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "history_entries" ADD CONSTRAINT "history_entries_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "history_entries" ADD CONSTRAINT "history_entries_formId_fkey" FOREIGN KEY ("formId") REFERENCES "contractor_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "history_entries" ADD CONSTRAINT "history_entries_actId_fkey" FOREIGN KEY ("actId") REFERENCES "acts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_read_marks" ADD CONSTRAINT "chat_read_marks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_read_marks" ADD CONSTRAINT "chat_read_marks_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actId_fkey" FOREIGN KEY ("actId") REFERENCES "acts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_importId_fkey" FOREIGN KEY ("importId") REFERENCES "import_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
