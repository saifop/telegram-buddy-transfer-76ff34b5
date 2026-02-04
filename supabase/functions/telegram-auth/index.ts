// Telegram Authentication Edge Function
// Note: Full MTProto integration requires a Node.js server
// This version provides the infrastructure for connecting to an external MTProto service
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

const validateVerificationCode = (code: string): boolean => {
  return /^\d{5,6}$/.test(code);
};

const validateUUID = (uuid: string): boolean => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
};

// Generic error response
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check for external MTProto service URL
    const mtprotoServiceUrl = Deno.env.get("MTPROTO_SERVICE_URL");

    // Parse request body
    const { action, ...params } = await req.json();
    console.log(`Telegram auth action: ${action}`);

    // If external service is configured, proxy requests to it
    if (mtprotoServiceUrl) {
      console.log("Using external MTProto service");
      try {
        const response = await fetch(mtprotoServiceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...params }),
        });
        const data = await response.json();
        return successResponse(data);
      } catch (err) {
        console.error("External service error:", err);
        return errorResponse("Failed to connect to authentication service", 500);
      }
    }

    // Demo mode: Simulate authentication flow
    console.log("Running in demo mode - real MTProto requires external service");

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

        // Generate session ID
        const tempUserId = crypto.randomUUID();

        // Store session in database
        const { data: session, error: insertError } = await supabase
          .from("telegram_sessions")
          .insert({
            user_id: tempUserId,
            api_id: parseInt(apiId),
            api_hash: apiHash,
            phone_number: phoneNumber,
            phone_code_hash: crypto.randomUUID(), // Demo placeholder
            step: "code_sent",
          })
          .select("id")
          .single();

        if (insertError) {
          console.error("Session creation error:", insertError);
          return errorResponse("Failed to create session", 500);
        }

        console.log(`Demo: Auth code request initiated for session: ${session.id}`);

        return successResponse({
          success: true,
          sessionId: session.id,
          message: "⚠️ وضع تجريبي: لتفعيل الإرسال الحقيقي، يرجى إضافة MTPROTO_SERVICE_URL",
          demoMode: true,
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

        // Demo: Accept any 5-6 digit code
        await supabase
          .from("telegram_sessions")
          .update({ step: "authenticated" })
          .eq("id", sessionId);

        console.log(`Demo: Code verified for session: ${sessionId}`);

        return successResponse({
          success: true,
          requiresPassword: false,
          message: "⚠️ وضع تجريبي: تم قبول الرمز",
          demoMode: true,
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

        // Demo: Accept any password
        await supabase
          .from("telegram_sessions")
          .update({ step: "authenticated" })
          .eq("id", sessionId);

        console.log(`Demo: 2FA verified for session: ${sessionId}`);

        return successResponse({
          success: true,
          message: "⚠️ وضع تجريبي: تم التحقق",
          demoMode: true,
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

        console.log(`Demo: Session extracted for phone: ${session.phone_number}`);

        // Generate demo session string
        const demoSessionData = {
          dc_id: 2,
          api_id: session.api_id,
          phone: session.phone_number,
          demo: true,
          created: Date.now(),
        };
        const sessionString = btoa(JSON.stringify(demoSessionData));

        // Clean up the session from database
        await supabase
          .from("telegram_sessions")
          .delete()
          .eq("id", sessionId);

        return successResponse({
          success: true,
          sessionString: sessionString,
          phone: session.phone_number,
          message: "⚠️ وضع تجريبي: هذا ليس ملف جلسة حقيقي",
          demoMode: true,
        });
      }

      default:
        return errorResponse("Invalid action");
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Telegram auth error:", errorMessage);
    return errorResponse("An unexpected error occurred", 500);
  }
});
