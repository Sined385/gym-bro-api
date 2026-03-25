-- CreateTable
CREATE TABLE "coach_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_messages_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "coach_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
