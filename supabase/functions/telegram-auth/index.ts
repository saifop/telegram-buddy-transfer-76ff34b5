// Telegram Authentication Edge Function
// Note: Full MTProto integration requires a Node.js server
// This version provides the infrastructure for connecting to an external MTProto service
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Normalize and validate an external MTProto service URL.
// - trims whitespace
// - if protocol is missing, prefixes with https://
// Returns a valid absolute URL string or null.
const normalizeServiceUrl = (rawUrl: unknown): string | null => {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Try as-is first
  try {
    return new URL(trimmed).toString();
  } catch {
    // If missing protocol, try https://
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return null;
    }
  }
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
    const mtprotoServiceUrlRaw = Deno.env.get("MTPROTO_SERVICE_URL");
    const mtprotoServiceUrl = normalizeServiceUrl(mtprotoServiceUrlRaw);
    const hadInvalidExternalUrl = Boolean(mtprotoServiceUrlRaw && !mtprotoServiceUrl);

    // Parse request body
    const { action, ...params } = await req.json();
    console.log(`Telegram auth action: ${action}`);

    // If external service is configured, proxy requests to it
    if (mtprotoServiceUrl) {
      console.log(`Using external MTProto service: ${mtprotoServiceUrl}`);
      try {
        const response = await fetch(mtprotoServiceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...params }),
        });

        // Try to parse JSON; if service returns non-JSON, surface a clear error
        let data: unknown = null;
        try {
          data = await response.json();
        } catch {
          return errorResponse(
            "Authentication service returned an invalid response",
            502,
          );
        }

        if (!response.ok) {
          console.error("External service non-OK status:", response.status, data);
          
          // Extract user-friendly error message from the external service
          const rawExternalError = (data as { error?: unknown })?.error;
          const externalError =
            typeof rawExternalError === "string"
              ? rawExternalError
              : rawExternalError
                ? JSON.stringify(rawExternalError)
                : "";

          // Some services wrap the Telegram error text inside other fields.
          // Build a combined text to match against reliably.
          const combinedErrorText = [externalError, JSON.stringify(data)].filter(Boolean).join("\n");

          if (combinedErrorText) {
            // Map common Telegram errors to user-friendly messages
            if (combinedErrorText.includes("CHAT_WRITE_FORBIDDEN")) {
            return errorResponse("ليس لديك صلاحية إضافة أعضاء لهذه المجموعة. تأكد أنك مشرف.", 403);
          }
            if (combinedErrorText.includes("USER_PRIVACY_RESTRICTED")) {
            return errorResponse("خصوصية المستخدم تمنع الإضافة", 403);
          }
            if (combinedErrorText.includes("USER_NOT_MUTUAL_CONTACT")) {
            return errorResponse("يجب أن يكون المستخدم جهة اتصال متبادلة", 403);
          }
            if (combinedErrorText.includes("PEER_FLOOD") || combinedErrorText.includes("FLOOD")) {
            // Try to extract wait time from error
              const waitMatch = combinedErrorText.match(/FLOOD_WAIT[_\s]*(\d+)/i);
            const waitSeconds = waitMatch ? waitMatch[1] : "60";
            return errorResponse(`تم تجاوز الحد المسموح. انتظر ${waitSeconds} ثانية قبل المحاولة`, 429);
          }
            if (combinedErrorText.includes("CHAT_ADMIN_REQUIRED")) {
            return errorResponse("يجب أن تكون مشرفاً للإضافة", 403);
          }
            if (combinedErrorText.includes("USER_ID_INVALID")) {
            return errorResponse("لا يمكن التعرف على هذا المستخدم. تأكد من وجود username أو أن الحساب شاهد المستخدم مسبقاً", 400);
          }
            if (combinedErrorText.includes("USER_NOT_PARTICIPANT")) {
            return errorResponse("المستخدم ليس عضواً في المجموعة المصدر", 400);
          }
            if (combinedErrorText.includes("USER_ALREADY_PARTICIPANT")) {
            return errorResponse("المستخدم موجود مسبقاً في المجموعة المستهدفة", 400);
          }
            if (combinedErrorText.includes("USER_CHANNELS_TOO_MUCH")) {
            return errorResponse("العضو موجود في أكثر من 500 مجموعة (حد تيليجرام) - تم تخطيه", 400);
          }
            if (combinedErrorText.includes("USERS_TOO_MUCH")) {
            return errorResponse("المجموعة المستهدفة وصلت للحد الأقصى من الأعضاء", 400);
          }
            if (combinedErrorText.includes("USER_BANNED_IN_CHANNEL")) {
            return errorResponse("العضو محظور من هذه المجموعة", 403);
          }
            if (combinedErrorText.includes("USER_KICKED")) {
            return errorResponse("العضو مطرود من هذه المجموعة ولا يمكن إضافته", 403);
          }
          // Return the original error message if not mapped
            return errorResponse(externalError || "Authentication service error", response.status);
          }
          
          return errorResponse("خادم المصادقة لا يستجيب (502). تأكد أن خادم Railway يعمل.", 502);
        }

        return successResponse(data as object);
      } catch (err) {
        console.error("External service error:", err);
        return errorResponse("فشل الاتصال بخادم المصادقة. تأكد أن خادم Railway يعمل.", 502);
      }
    }

    // Demo mode: Simulate authentication flow
    if (hadInvalidExternalUrl) {
      console.error(
        "Invalid MTPROTO_SERVICE_URL configured; falling back to demo mode.",
      );
    }
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
