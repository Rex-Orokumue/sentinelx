-- Web "Clear chat" now goes through the clearMyChatHistory server action and DELETE /api/mobile/v1/chat/history
-- (both service role, via lib/chat/history.ts). Remove the client delete path so there is exactly one way to
-- delete chat history. Reads (chat_messages_self_select) are unchanged.
DROP POLICY IF EXISTS "chat_messages_self_delete" ON public.chat_messages;
