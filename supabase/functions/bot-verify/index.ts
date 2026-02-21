/**
 * Bot Verification Edge Function
 * Uses Telegram Bot API to verify actual member count in a group
 * and compare with reported additions
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  console.log("bot-verify called, method:", req.method);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  console.log("BOT_TOKEN exists:", !!BOT_TOKEN);
  if (!BOT_TOKEN) {
    return new Response(
      JSON.stringify({ error: 'Bot token not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json();
    const { action, groupLink, chatId } = body;

    const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

    if (action === 'getMemberCount') {
      // Resolve group identifier
      let identifier = groupLink || chatId;
      if (!identifier) {
        return new Response(
          JSON.stringify({ error: 'groupLink or chatId required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Normalize the group link to a username or chat_id
      if (typeof identifier === 'string') {
        // Strip https://t.me/
        identifier = identifier.replace(/^https?:\/\/t\.me\//, '');
        // Add @ prefix for usernames if not already there
        if (!identifier.startsWith('@') && !identifier.startsWith('-')) {
          identifier = '@' + identifier;
        }
        // Handle private invite links (t.me/+HASH) — bot cannot resolve these
        if (identifier.startsWith('+')) {
          return new Response(
            JSON.stringify({ 
              error: 'PRIVATE_LINK: البوت لا يستطيع الوصول إلى روابط الدعوة الخاصة. أضف البوت للمجموعة أولاً ثم استخدم @username أو chat_id',
              isPrivateLink: true,
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Call getChat to get basic info
      const chatRes = await fetch(`${TELEGRAM_API}/getChat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: identifier }),
      });
      const chatData = await chatRes.json();

      if (!chatData.ok) {
        return new Response(
          JSON.stringify({ 
            error: `Bot API Error: ${chatData.description}`,
            hint: 'تأكد من أن البوت @CO0k12bot مضاف كعضو في المجموعة المستهدفة',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const chat = chatData.result;
      const resolvedChatId = chat.id;
      const chatTitle = chat.title;
      const chatType = chat.type;

      // Call getChatMemberCount for accurate count
      const countRes = await fetch(`${TELEGRAM_API}/getChatMemberCount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: resolvedChatId }),
      });
      const countData = await countRes.json();

      if (!countData.ok) {
        return new Response(
          JSON.stringify({ error: `Count Error: ${countData.description}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          chatId: resolvedChatId,
          chatTitle,
          chatType,
          memberCount: countData.result,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'getBotInfo') {
      const meRes = await fetch(`${TELEGRAM_API}/getMe`);
      const meData = await meRes.json();
      console.log("getMe response:", JSON.stringify(meData));
      if (!meData.ok) {
        return new Response(
          JSON.stringify({ error: meData.description }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: true, bot: meData.result }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
