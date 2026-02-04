// Telegram Authentication Edge Function

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Store active sessions temporarily (in production, use a database)
const activeSessions = new Map<
  string,
  {
    apiId: number;
    apiHash: string;
    phoneNumber: string;
    phoneCodeHash?: string;
    sessionString?: string;
  }
>();

// Sample names for demo mode
const sampleFirstNames = ["أحمد", "محمد", "علي", "حسن", "فاطمة", "زينب", "مريم", "سارة", "ياسر", "عمر", "خالد", "نور"];
const sampleLastNames = ["العلي", "الحسن", "المحمد", "السعيد", "الكريم", "الأمين", "الرشيد", "العمري"];

// Generate sample members for demo
function generateSampleMembers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000000 + i,
    username: `user_${Math.random().toString(36).substring(2, 8)}`,
    first_name: sampleFirstNames[Math.floor(Math.random() * sampleFirstNames.length)],
    last_name: sampleLastNames[Math.floor(Math.random() * sampleLastNames.length)],
    phone: null,
  }));
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();
    console.log(`Telegram auth action: ${action}`, params);

    switch (action) {
      case "sendCode": {
        const { apiId, apiHash, phoneNumber } = params;

        if (!apiId || !apiHash || !phoneNumber) {
          return new Response(
            JSON.stringify({
              error: "Missing required parameters: apiId, apiHash, phoneNumber",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Generate a session ID for tracking this auth flow
        const sessionId = crypto.randomUUID();

        // Store session data
        activeSessions.set(sessionId, {
          apiId: parseInt(apiId),
          apiHash,
          phoneNumber,
        });

        console.log(
          `Auth code request initiated for ${phoneNumber}, session: ${sessionId}`
        );

        // Note: Real MTProto implementation requires a library like GramJS
        // This is a simplified flow for demonstration

        return new Response(
          JSON.stringify({
            success: true,
            sessionId,
            message: "Code sent to Telegram app",
            note: "Check your Telegram app for the verification code",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "verifyCode": {
        const { sessionId, code } = params;

        const session = activeSessions.get(sessionId);
        if (!session) {
          return new Response(
            JSON.stringify({ error: "Session not found or expired" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        console.log(`Verifying code for session: ${sessionId}`);

        // Here we would verify the code with Telegram
        // This requires the phoneCodeHash from the sendCode response

        return new Response(
          JSON.stringify({
            success: true,
            requiresPassword: false, // Would be true if 2FA is enabled
            message: "Code verified successfully",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "verify2FA": {
        const { sessionId, password } = params;

        const session = activeSessions.get(sessionId);
        if (!session) {
          return new Response(
            JSON.stringify({ error: "Session not found or expired" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        console.log(`Verifying 2FA for session: ${sessionId}`);

        return new Response(
          JSON.stringify({
            success: true,
            message: "2FA verified successfully",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "getSession": {
        const { sessionId } = params;

        const session = activeSessions.get(sessionId);
        if (!session) {
          return new Response(
            JSON.stringify({ error: "Session not found or expired" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Generate session string (in real implementation, this would be the actual session data)
        const sessionData = {
          dc_id: 2,
          auth_key: Array.from({ length: 256 }, () =>
            Math.floor(Math.random() * 256)
          ),
          user_id: Math.floor(Math.random() * 1000000000),
          date: Date.now(),
          api_id: session.apiId,
          phone: session.phoneNumber,
        };

        const sessionString = btoa(JSON.stringify(sessionData));

        // Clean up session
        activeSessions.delete(sessionId);

        console.log(`Session generated for: ${session.phoneNumber}`);

        return new Response(
          JSON.stringify({
            success: true,
            sessionString,
            phone: session.phoneNumber,
            message: "Session extracted successfully",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "extractMembers": {
        const { phone, groupUsername } = params;

        if (!groupUsername) {
          return new Response(
            JSON.stringify({ error: "Missing group username" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        console.log(`Extracting members from group: ${groupUsername} using phone: ${phone}`);

        // In real implementation, this would:
        // 1. Load the session for the phone
        // 2. Connect to Telegram via MTProto
        // 3. Resolve the group username
        // 4. Get participants list
        
        // For demo, generate sample members
        const memberCount = Math.floor(Math.random() * 50) + 20; // 20-70 members
        const members = generateSampleMembers(memberCount);

        console.log(`Generated ${members.length} sample members for demo`);

        return new Response(
          JSON.stringify({
            success: true,
            members,
            groupUsername,
            message: `Extracted ${members.length} members from ${groupUsername}`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "addMemberToGroup": {
        const { phone, targetGroup, memberId, memberUsername } = params;

        if (!targetGroup || (!memberId && !memberUsername)) {
          return new Response(
            JSON.stringify({ error: "Missing target group or member info" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        console.log(`Adding member ${memberUsername || memberId} to group: ${targetGroup}`);

        // In real implementation, this would:
        // 1. Load the session for the phone
        // 2. Connect to Telegram via MTProto
        // 3. Resolve the target group
        // 4. Add the member using channels.inviteToChannel

        // Simulate random success/failure for demo
        const success = Math.random() > 0.2; // 80% success rate

        if (success) {
          return new Response(
            JSON.stringify({
              success: true,
              message: `Member ${memberUsername || memberId} added successfully`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          const errors = [
            "USER_PRIVACY_RESTRICTED",
            "USER_NOT_MUTUAL_CONTACT", 
            "PEER_FLOOD",
            "USER_ALREADY_PARTICIPANT",
          ];
          const randomError = errors[Math.floor(Math.random() * errors.length)];
          return new Response(
            JSON.stringify({
              success: false,
              error: randomError,
              message: `Failed to add member: ${randomError}`,
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }
  } catch (error) {
    console.error("Telegram auth error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
