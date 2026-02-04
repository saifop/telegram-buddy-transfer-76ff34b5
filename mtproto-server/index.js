/**
 * Telegram MTProto Authentication Server
 * 
 * This server handles real Telegram authentication using GramJS.
 * Deploy this on Railway, Render, or any Node.js hosting service.
 * 
 * Environment Variables Required:
 * - PORT (optional, defaults to 3000)
 * 
 * After deploying, set MTPROTO_SERVICE_URL in your Supabase secrets
 * to point to this server's URL.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins
app.use(cors());
app.use(express.json());

// Store active sessions in memory (use Redis for production)
const activeSessions = new Map();

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Telegram MTProto Server is running',
    version: '1.0.0'
  });
});

// Main authentication endpoint
app.post('/auth', async (req, res) => {
  const { action, ...params } = req.body;
  console.log(`[${new Date().toISOString()}] Action: ${action}`);

  try {
    switch (action) {
      case 'sendCode':
        return await handleSendCode(params, res);
      case 'verifyCode':
        return await handleVerifyCode(params, res);
      case 'verify2FA':
        return await handleVerify2FA(params, res);
      case 'getSession':
        return await handleGetSession(params, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: error.message || 'An unexpected error occurred' 
    });
  }
});

/**
 * Send verification code to phone number
 */
async function handleSendCode({ apiId, apiHash, phoneNumber }, res) {
  // Validate inputs
  if (!apiId || !apiHash || !phoneNumber) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const stringSession = new StringSession('');
    const client = new TelegramClient(stringSession, parseInt(apiId), apiHash, {
      connectionRetries: 5,
    });

    console.log('Connecting to Telegram...');
    await client.connect();
    console.log('Connected!');

    // Send the verification code
    console.log(`Sending code to ${phoneNumber}...`);
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phoneNumber,
        apiId: parseInt(apiId),
        apiHash: apiHash,
        settings: new Api.CodeSettings({}),
      })
    );

    console.log('Code sent successfully!');

    // Generate a unique session ID
    const sessionId = generateSessionId();

    // Store the session data
    activeSessions.set(sessionId, {
      client,
      phoneNumber,
      phoneCodeHash: result.phoneCodeHash,
      apiId: parseInt(apiId),
      apiHash,
      createdAt: Date.now(),
    });

    // Auto-cleanup after 10 minutes
    setTimeout(() => {
      if (activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId);
        session.client.disconnect().catch(() => {});
        activeSessions.delete(sessionId);
        console.log(`Session ${sessionId} expired and cleaned up`);
      }
    }, 10 * 60 * 1000);

    return res.json({
      success: true,
      sessionId,
      message: 'Code sent to Telegram app',
    });

  } catch (error) {
    console.error('SendCode error:', error);
    
    // Handle specific Telegram errors
    const errorMessage = error.message || '';
    if (errorMessage.includes('PHONE_NUMBER_INVALID')) {
      return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
    }
    if (errorMessage.includes('PHONE_NUMBER_BANNED')) {
      return res.status(400).json({ error: 'رقم الهاتف محظور' });
    }
    if (errorMessage.includes('PHONE_NUMBER_FLOOD')) {
      return res.status(429).json({ error: 'تم إرسال عدة طلبات. انتظر قبل المحاولة مرة أخرى' });
    }
    if (errorMessage.includes('API_ID_INVALID')) {
      return res.status(400).json({ error: 'API ID غير صالح' });
    }
    
    return res.status(500).json({ error: `خطأ في الاتصال بتيليجرام: ${errorMessage}` });
  }
}

/**
 * Verify the code sent to the phone
 */
async function handleVerifyCode({ sessionId, code }, res) {
  if (!sessionId || !code) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(400).json({ error: 'Session expired or not found' });
  }

  try {
    const { client, phoneNumber, phoneCodeHash } = session;

    // Try to sign in with the code
    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phoneNumber,
          phoneCodeHash: phoneCodeHash,
          phoneCode: code,
        })
      );

      console.log('Sign in successful!');

      // Get user info
      const me = await client.getMe();
      session.user = me;
      session.authenticated = true;

      return res.json({
        success: true,
        requiresPassword: false,
        message: 'Code verified successfully',
      });

    } catch (signInError) {
      const errorMessage = signInError.message || '';

      // Check if 2FA is required
      if (errorMessage.includes('SESSION_PASSWORD_NEEDED')) {
        console.log('2FA password required');
        session.requires2FA = true;
        return res.json({
          success: true,
          requiresPassword: true,
          message: '2FA password required',
        });
      }

      if (errorMessage.includes('PHONE_CODE_INVALID')) {
        return res.status(400).json({ error: 'رمز التحقق غير صحيح' });
      }
      if (errorMessage.includes('PHONE_CODE_EXPIRED')) {
        return res.status(400).json({ error: 'انتهت صلاحية رمز التحقق' });
      }

      throw signInError;
    }

  } catch (error) {
    console.error('VerifyCode error:', error);
    return res.status(500).json({ error: `خطأ في التحقق: ${error.message}` });
  }
}

/**
 * Verify 2FA password
 */
async function handleVerify2FA({ sessionId, password }, res) {
  if (!sessionId || !password) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(400).json({ error: 'Session expired or not found' });
  }

  try {
    const { client } = session;

    // Check password using the client's method
    await client.signInWithPassword(
      {
        password: async () => password,
        onError: (err) => {
          throw err;
        },
      }
    );

    console.log('2FA verified successfully!');

    // Get user info
    const me = await client.getMe();
    session.user = me;
    session.authenticated = true;

    return res.json({
      success: true,
      message: '2FA verified successfully',
    });

  } catch (error) {
    console.error('Verify2FA error:', error);
    
    const errorMessage = error.message || '';
    if (errorMessage.includes('PASSWORD_HASH_INVALID')) {
      return res.status(400).json({ error: 'كلمة المرور غير صحيحة' });
    }
    
    return res.status(500).json({ error: `خطأ في التحقق: ${errorMessage}` });
  }
}

/**
 * Get the session string for an authenticated session
 */
async function handleGetSession({ sessionId }, res) {
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing session ID' });
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(400).json({ error: 'Session expired or not found' });
  }

  if (!session.authenticated) {
    return res.status(400).json({ error: 'Session not authenticated' });
  }

  try {
    const { client, phoneNumber } = session;

    // Get the session string
    const sessionString = client.session.save();

    console.log(`Session extracted for ${phoneNumber}`);

    // Disconnect and cleanup
    await client.disconnect();
    activeSessions.delete(sessionId);

    return res.json({
      success: true,
      sessionString,
      phone: phoneNumber,
      message: 'Session extracted successfully',
    });

  } catch (error) {
    console.error('GetSession error:', error);
    return res.status(500).json({ error: `خطأ في استخراج الجلسة: ${error.message}` });
  }
}

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  return 'sess_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Cleanup on shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  for (const [id, session] of activeSessions) {
    try {
      await session.client.disconnect();
    } catch (e) {
      // Ignore disconnect errors
    }
  }
  process.exit(0);
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Telegram MTProto Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/`);
  console.log(`🔐 Auth endpoint: POST http://localhost:${PORT}/auth`);
});
