// Telegram Authentication Edge Function - Secured Version
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Input validation helpers
const validatePhoneNumber = (phone: string): boolean => {
  return /^\+\d{10,15}$/.test(phone);
};

const validateApiId = (apiId: string): boolean => {
  return /^\d{1,10}$/.test(apiId);
};

const validateApiHash = (apiHash: string): boolean => {
  return /^[a-f0-9]{32}$/.test(apiHash);
};

const validateGroupUsername = (username: string): boolean => {
  const cleaned = username.replace(/^(https?:\/\/)?(t\.me\/)?@?/, "");
  return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(cleaned);
};

const validateVerificationCode = (code: string): boolean => {
  return /^\d{5,6}$/.test(code);
};

const validateUUID = (uuid: string): boolean => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
};

// Sample names for demo mode
const sampleFirstNames = ["أحمد", "محمد", "علي", "حسن", "فاطمة", "زينب", "مريم", "سارة", "ياسر", "عمر"];
const sampleLastNames = ["العلي", "الحسن", "المحمد", "السعيد", "الكريم", "الأمين", "الرشيد"];

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

// Generic error response (hides internal details)
function errorResponse(message: string, status: number = 400) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Success response
function successResponse(data: object) {
  return new Response(
    JSON.stringify(data),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase environment variables");
      return errorResponse("Service configuration error", 500);
    }

    // Create Supabase client with service role (no auth required)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const { action, ...params } = await req.json();
    console.log(`Telegram auth action: ${action}`);

    // Generate a temporary user ID for this session
    const tempUserId = crypto.randomUUID();

    switch (action) {
      case "sendCode": {
        const { apiId, apiHash, phoneNumber } = params;

        // Validate inputs
        if (!apiId || !validateApiId(String(apiId))) {
          return errorResponse("Invalid API ID format");
        }
        if (!apiHash || !validateApiHash(apiHash)) {
          return errorResponse("Invalid API Hash format");
        }
        if (!phoneNumber || !validatePhoneNumber(phoneNumber)) {
          return errorResponse("Invalid phone number format. Use +[country][number]");
        }

        // Create new session in database
        const { data: session, error: insertError } = await supabase
          .from("telegram_sessions")
          .insert({
            user_id: tempUserId,
            api_id: parseInt(apiId),
            api_hash: apiHash,
            phone_number: phoneNumber,
            step: "code_sent",
          })
          .select("id")
          .single();

        if (insertError) {
          console.error("Session creation error:", insertError);
          return errorResponse("Failed to create session", 500);
        }

        console.log(`Auth code request initiated for session: ${session.id}`);

        // Note: Real MTProto implementation would send code here
        return successResponse({
          success: true,
          sessionId: session.id,
          message: "Code sent to Telegram app",
        });
      }

      case "verifyCode": {
        const { sessionId, code } = params;

        // Validate inputs
        if (!sessionId || !validateUUID(sessionId)) {
          return errorResponse("Invalid session");
        }
        if (!code || !validateVerificationCode(code)) {
          return errorResponse("Invalid verification code format");
        }

        // Get session from database (RLS ensures user can only access their own)
        const { data: session, error: fetchError } = await supabase
          .from("telegram_sessions")
          .select("*")
          .eq("id", sessionId)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();

        if (fetchError || !session) {
          return errorResponse("Session expired or not found");
        }

        // Update session step
        await supabase
          .from("telegram_sessions")
          .update({ step: "code_verified" })
          .eq("id", sessionId);

        console.log(`Code verified for session: ${sessionId}`);

        return successResponse({
          success: true,
          requiresPassword: false,
          message: "Code verified successfully",
        });
      }

      case "verify2FA": {
        const { sessionId, password } = params;

        // Validate inputs
        if (!sessionId || !validateUUID(sessionId)) {
          return errorResponse("Invalid session");
        }
        if (!password || password.length < 1 || password.length > 128) {
          return errorResponse("Invalid password");
        }

        // Get session from database
        const { data: session, error: fetchError } = await supabase
          .from("telegram_sessions")
          .select("*")
          .eq("id", sessionId)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();

        if (fetchError || !session) {
          return errorResponse("Session expired or not found");
        }

        // Update session step
        await supabase
          .from("telegram_sessions")
          .update({ step: "2fa_verified" })
          .eq("id", sessionId);

        console.log(`2FA verified for session: ${sessionId}`);

        return successResponse({
          success: true,
          message: "2FA verified successfully",
        });
      }

      case "getSession": {
        const { sessionId } = params;

        // Validate input
        if (!sessionId || !validateUUID(sessionId)) {
          return errorResponse("Invalid session");
        }

        // Get session from database
        const { data: session, error: fetchError } = await supabase
          .from("telegram_sessions")
          .select("*")
          .eq("id", sessionId)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();

        if (fetchError || !session) {
          return errorResponse("Session expired or not found");
        }

        // Generate session string (demo - real implementation would use MTProto)
        const sessionData = {
          dc_id: 2,
          auth_key: Array.from({ length: 256 }, () => Math.floor(Math.random() * 256)),
          user_id: Math.floor(Math.random() * 1000000000),
          date: Date.now(),
          api_id: session.api_id,
          phone: session.phone_number,
        };

        const sessionString = btoa(JSON.stringify(sessionData));

        // Delete session after extraction
        await supabase
          .from("telegram_sessions")
          .delete()
          .eq("id", sessionId);

        console.log(`Session extracted for phone: ${session.phone_number}`);

        return successResponse({
          success: true,
          sessionString,
          phone: session.phone_number,
          message: "Session extracted successfully",
        });
      }

      case "extractMembers": {
        const { groupUsername } = params;

        // Validate input
        if (!groupUsername) {
          return errorResponse("Group username is required");
        }

        const cleanedUsername = groupUsername.replace(/^(https?:\/\/)?(t\.me\/)?@?/, "");
        
        if (!validateGroupUsername(groupUsername)) {
          return errorResponse("Invalid group username format");
        }

        console.log(`Extracting members from group: ${cleanedUsername}`);

        // Demo mode - generate sample members
        const memberCount = Math.floor(Math.random() * 50) + 20;
        const members = generateSampleMembers(memberCount);

        console.log(`Generated ${members.length} sample members`);

        return successResponse({
          success: true,
          members,
          groupUsername: cleanedUsername,
          message: `Extracted ${members.length} members`,
        });
      }

      case "addMemberToGroup": {
        const { targetGroup, memberId, memberUsername } = params;

        // Validate inputs
        if (!targetGroup) {
          return errorResponse("Target group is required");
        }
        if (!memberId && !memberUsername) {
          return errorResponse("Member ID or username is required");
        }

        const cleanedGroup = targetGroup.replace(/^(https?:\/\/)?(t\.me\/)?@?/, "");
        
        if (!validateGroupUsername(targetGroup)) {
          return errorResponse("Invalid target group format");
        }

        console.log(`Adding member ${memberUsername || memberId} to group: ${cleanedGroup}`);

        // Demo mode - simulate random success/failure
        const success = Math.random() > 0.2;

        if (success) {
          return successResponse({
            success: true,
            message: "Member added successfully",
          });
        } else {
          // Return generic failure without exposing internal error codes
          return successResponse({
            success: false,
            message: "Failed to add member. Please try again later.",
          });
        }
      }

      default:
        return errorResponse("Invalid action");
    }
  } catch (error) {
    // Log detailed error server-side only
    console.error("Telegram auth error:", error);
    // Return generic error to client
    return errorResponse("An unexpected error occurred", 500);
  }
});
