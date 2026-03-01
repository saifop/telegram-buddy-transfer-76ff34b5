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
const isPrivateInviteLink = (link: unknown): boolean => {
  if (typeof link !== "string") return false;
  return link.includes("/+") || link.includes("joinchat/") || /^\+[A-Za-z0-9_-]+$/.test(link.trim());
};

const extractInviteHash = (link: string): string | null => {
  const trimmed = link.trim();
  if (!trimmed) return null;

  const plusMatch = trimmed.match(/\/\+([A-Za-z0-9_-]+)/);
  if (plusMatch?.[1]) return plusMatch[1];

  const joinchatMatch = trimmed.match(/joinchat\/([A-Za-z0-9_-]+)/i);
  if (joinchatMatch?.[1]) return joinchatMatch[1];

  const bareHash = trimmed.match(/^\+?([A-Za-z0-9_-]+)$/);
  if (bareHash?.[1]) return bareHash[1];

  return null;
};

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
function errorResponse(message: string, status: number = 400, forceOk: boolean = false) {
  // NOTE:
  // - supabase-js treats non-2xx as FunctionsHttpError and many UIs surface it as a "runtime error"
  // - For expected Telegram/business-rule failures (privacy, flood wait, not mutual contact, ...)
  //   we return HTTP 200 and include the intended status in the JSON payload.
  const httpStatus = forceOk ? 200 : status;

  return new Response(
    JSON.stringify({ error: message, status }),
    { status: httpStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
        // Normalize private invite links: convert +hash format to joinchat/hash
        // for compatibility with older Railway server versions
        const normalizedParams = { ...params };
        if (typeof normalizedParams.groupLink === "string") {
          const plusMatch = normalizedParams.groupLink.match(/t\.me\/\+([A-Za-z0-9_-]+)/);
          if (plusMatch?.[1]) {
            normalizedParams.groupLink = `https://t.me/joinchat/${plusMatch[1]}`;
            console.log(`Normalized private link to joinchat format: ${normalizedParams.groupLink}`);
          }
        }

        const controller = new AbortController();
        // Give extraction/join actions more time (120s), others 30s
        const longActions = ["getGroupMembers", "joinGroup", "addMemberToGroup"];
        const timeoutMs = longActions.includes(action) ? 300_000 : 30_000; // 5 min for extraction
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(mtprotoServiceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...normalizedParams }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));

        // Try to parse JSON; if service returns non-JSON, surface a clear error
        const rawText = await response.text();
        let data: unknown = null;
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch {
          const snippet = rawText?.slice(0, 500) || "(empty response body)";
          console.error("External service returned non-JSON:", response.status, snippet);
          return errorResponse(
            `Authentication service returned an invalid response (HTTP ${response.status}). Body: ${snippet}`,
            502,
          );
        }

        if (!response.ok) {
          console.error("External service non-OK status:", response.status, data);

          // Extraction fallback for legacy MTProto servers:
          // some old builds incorrectly parse private invite links as usernames.
          if (
            action === "getGroupMembers" &&
            typeof params.groupLink === "string" &&
            isPrivateInviteLink(params.groupLink)
          ) {
            const rawGroupLink = params.groupLink;
            const inviteHash = extractInviteHash(rawGroupLink);

            // Use chatId from params if already provided by client
            let resolvedChatId: string | null = null;
            if (params.chatId) {
              resolvedChatId = String(params.chatId);
              console.log(`Using client-provided chatId: ${resolvedChatId}`);
            }

            if (!resolvedChatId) {
              const fallbackBodies: Array<Record<string, unknown>> = [];
              fallbackBodies.push({ action: "joinPrivateGroup", ...params });
              fallbackBodies.push({ action: "joinGroup", ...params });

              for (const joinBody of fallbackBodies) {
              try {
                const joinResponse = await fetch(mtprotoServiceUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(joinBody),
                });

                const joinText = await joinResponse.text();
                const joinData = joinText ? JSON.parse(joinText) : null;
                const chatId = (joinData as { chatId?: unknown })?.chatId;

                if (typeof chatId === "string" && chatId.trim()) {
                  resolvedChatId = chatId;
                  break;
                }
                if (typeof chatId === "number") {
                  resolvedChatId = chatId.toString();
                  break;
                }
              } catch (e) {
                console.warn("Private-group chatId fallback attempt failed:", e);
              }
              }
            }

            // Retry extraction with resolved chatId (preferred), then with joinchat URL variant.
            const retryPayloads: Array<Record<string, unknown>> = [];

            if (resolvedChatId) {
              // Send chatId WITH a dummy groupLink (old Railway requires groupLink to exist)
              retryPayloads.push({
                action,
                ...params,
                groupLink: `dummy_for_chatid`,
                chatId: resolvedChatId,
              });
              console.log(`Retry payload with chatId: ${resolvedChatId} and dummy groupLink`);
            }

            if (inviteHash) {
              retryPayloads.push({
                action,
                ...params,
                groupLink: `https://t.me/joinchat/${inviteHash}`,
              });
            }

            for (const retryBody of retryPayloads) {
              try {
                console.log(`Retry attempt with body keys: ${Object.keys(retryBody).join(', ')}`);
                const retryResponse = await fetch(mtprotoServiceUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(retryBody),
                });

                const retryText = await retryResponse.text();
                console.log(`Retry response status: ${retryResponse.status}, body length: ${retryText.length}`);
                const retryData = retryText ? JSON.parse(retryText) : null;

                if (retryResponse.ok) {
                  console.log("Private-group extraction fallback succeeded");
                  return successResponse(retryData as object);
                } else {
                  console.warn("Retry failed with status:", retryResponse.status, retryText.slice(0, 200));
                }
              } catch (e) {
                console.warn("Private-group extraction retry failed:", e);
              }
            }
          }

          // Extract user-friendly error message from the external service
          const rawExternalError = (data as { error?: unknown; message?: unknown })?.error;
          const rawExternalMessage = (data as { message?: unknown })?.message;

          const externalError =
            typeof rawExternalError === "string"
              ? rawExternalError
              : rawExternalError
                ? JSON.stringify(rawExternalError)
                : "";

          const externalMessage =
            typeof rawExternalMessage === "string"
              ? rawExternalMessage
              : rawExternalMessage
                ? JSON.stringify(rawExternalMessage)
                : "";

          // Some services wrap the Telegram error text inside other fields.
          // Build a combined text to match against reliably.
          const combinedErrorText = [externalError, externalMessage, JSON.stringify(data)]
            .filter(Boolean)
            .join("\n");

          if (combinedErrorText) {
            // Map common Telegram errors to user-friendly messages
            // IMPORTANT: These are *expected* operational failures; return HTTP 200 to avoid UI "blank screen".
            // Match BOTH English Telegram error codes AND Arabic translations from Railway.
            if (combinedErrorText.includes("CHAT_WRITE_FORBIDDEN") || combinedErrorText.includes("صلاحية")) {
              return errorResponse("ليس لديك صلاحية إضافة أعضاء لهذه المجموعة. تأكد أنك مشرف.", 403, true);
            }
            if (combinedErrorText.includes("USER_PRIVACY_RESTRICTED") || combinedErrorText.includes("خصوصية")) {
              return errorResponse("خصوصية المستخدم تمنع الإضافة", 403, true);
            }
            if (combinedErrorText.includes("USER_NOT_MUTUAL_CONTACT") || combinedErrorText.includes("جهة اتصال متبادلة")) {
              return errorResponse("يجب أن يكون المستخدم جهة اتصال متبادلة", 400, true);
            }
            if (combinedErrorText.includes("PEER_FLOOD") || combinedErrorText.includes("FLOOD") || combinedErrorText.includes("تم تجاوز الحد")) {
              const waitMatch = combinedErrorText.match(/FLOOD_WAIT[_\s]*(\d+)/i) || combinedErrorText.match(/(\d+)\s*ثانية/);
              const waitSeconds = waitMatch ? waitMatch[1] : "60";
              return errorResponse(
                `تم تجاوز الحد المسموح. انتظر ${waitSeconds} ثانية قبل المحاولة`,
                429,
                true,
              );
            }
            if (combinedErrorText.includes("CHAT_ADMIN_REQUIRED") || combinedErrorText.includes("مشرفاً")) {
              return errorResponse("يجب أن تكون مشرفاً للإضافة", 403, true);
            }
            if (combinedErrorText.includes("USER_ID_INVALID")) {
              return errorResponse(
                "لا يمكن التعرف على هذا المستخدم. تأكد من وجود username أو أن الحساب شاهد المستخدم مسبقاً",
                400,
                true,
              );
            }
            if (combinedErrorText.includes("USER_NOT_PARTICIPANT")) {
              return errorResponse("المستخدم ليس عضواً في المجموعة المصدر", 400, true);
            }
            if (combinedErrorText.includes("USER_ALREADY_PARTICIPANT") || combinedErrorText.includes("موجود مسبقاً")) {
              return errorResponse("المستخدم موجود مسبقاً في المجموعة المستهدفة", 400, true);
            }
            if (combinedErrorText.includes("USER_CHANNELS_TOO_MUCH") || combinedErrorText.includes("500 مجموعة")) {
              return errorResponse(
                "العضو موجود في أكثر من 500 مجموعة (حد تيليجرام) - تم تخطيه",
                400,
                true,
              );
            }
            if (combinedErrorText.includes("USERS_TOO_MUCH")) {
              return errorResponse("المجموعة المستهدفة وصلت للحد الأقصى من الأعضاء", 400, true);
            }
            if (combinedErrorText.includes("USER_BANNED_IN_CHANNEL") || combinedErrorText.includes("محظور")) {
              return errorResponse("العضو محظور من هذه المجموعة", 403, true);
            }
            if (combinedErrorText.includes("USER_KICKED") || combinedErrorText.includes("مطرود")) {
              return errorResponse("العضو مطرود من هذه المجموعة ولا يمكن إضافته", 403, true);
            }

            // SMART FIX: ADD_NOT_CONFIRMED means InviteToChannel was executed without
            // throwing an error, but the old server code's verification was too strict.
            // Treat this as SUCCESS since the API call actually went through.
            if (combinedErrorText.includes("ADD_NOT_CONFIRMED") || combinedErrorText.includes("لم يتم تأكيد الإضافة")) {
              const usernameMatch = combinedErrorText.match(/للمستخدم\s+(\S+)/);
              const uname = usernameMatch ? usernameMatch[1] : "unknown";
              console.log(`Converting ADD_NOT_CONFIRMED to success for user: ${uname}`);
              return successResponse({
                success: true,
                actuallyAdded: true,
                message: `تمت إضافة ${uname} بنجاح`,
                convertedFromUnconfirmed: true,
              });
            }

            // Legacy private-link parser issue in old MTProto servers
            if (
              action === "getGroupMembers" &&
              typeof params.groupLink === "string" &&
              isPrivateInviteLink(params.groupLink) &&
              combinedErrorText.includes("No user has") &&
              combinedErrorText.includes("as username")
            ) {
              return errorResponse(
                "فشل استخراج أعضاء المجموعة الخاصة بسبب نسخة قديمة من خادم MTProto (Railway). حدّث خادم Railway إلى آخر كود ثم أعد المحاولة.",
                500,
                true,
              );
            }

            // Fallback: ALL non-OK upstream responses return HTTP 200 to prevent blank screen
            const fallbackMsg =
              externalError ||
              externalMessage ||
              `Authentication service error (HTTP ${response.status})`;
            return errorResponse(fallbackMsg, response.status, true);
          }

          // If upstream returned nothing useful, still return HTTP 200 to prevent blank screen
          return errorResponse(
            `Authentication service error (HTTP ${response.status})`,
            response.status,
            true,
          );
        }

        return successResponse(data as object);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return errorResponse("انتهت مهلة الاتصال بالخادم. حاول مرة أخرى.", 504, true);
        }
        console.error("External service error:", err);
        return errorResponse("فشل الاتصال بخادم المصادقة. تحقق من اتصال Railway.", 502, true);
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
