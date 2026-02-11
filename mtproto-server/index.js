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
      case 'joinGroup':
        return await handleJoinGroup(params, res);
      case 'joinPrivateGroup':
        return await handleJoinPrivateGroup(params, res);
      case 'leaveGroup':
        return await handleLeaveGroup(params, res);
      case 'getGroupMembers':
        return await handleGetGroupMembers(params, res);
      case 'addMemberToGroup':
        return await handleAddMemberToGroup(params, res);
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
 * Parse group link to get username or invite hash
 */
function parseGroupLink(groupLink) {
  if (!groupLink) return { type: null, value: null };
  
  const trimmed = groupLink.trim();
  
  // Handle @username format
  if (trimmed.startsWith('@')) {
    return { type: 'username', value: trimmed.substring(1) };
  }
  
  // Handle t.me/username or t.me/joinchat/hash
  const tmeMatch = trimmed.match(/t\.me\/(?:joinchat\/)?([a-zA-Z0-9_\-+]+)/);
  if (tmeMatch) {
    const value = tmeMatch[1];
    // Check if it's a join link (private group)
    if (trimmed.includes('joinchat') || trimmed.includes('+')) {
      return { type: 'hash', value: value.replace('+', '') };
    }
    return { type: 'username', value };
  }
  
  // Assume it's a username if nothing else matches
  return { type: 'username', value: trimmed };
}

/**
 * Get or create a client from session string
 */
async function getClientFromSession(sessionString, apiId, apiHash) {
  const stringSession = new StringSession(sessionString);
  const client = new TelegramClient(stringSession, parseInt(apiId), apiHash, {
    connectionRetries: 5,
  });
  await client.connect();
  return client;
}

/**
 * Join a public group by username
 */
async function handleJoinGroup({ sessionString, groupLink, apiId, apiHash }, res) {
  if (!sessionString || !groupLink) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const client = await getClientFromSession(sessionString, apiId || 123456, apiHash || 'demo');
    
    const { type, value } = parseGroupLink(groupLink);
    
    if (!value) {
      return res.status(400).json({ error: 'Invalid group link' });
    }
    
    console.log(`Joining group: ${value} (type: ${type})`);
    
    if (type === 'hash') {
      // Private group - use import invite
      await client.invoke(
        new Api.messages.ImportChatInvite({
          hash: value,
        })
      );
    } else {
      // Public group - join by username
      await client.invoke(
        new Api.channels.JoinChannel({
          channel: value,
        })
      );
    }
    
    await client.disconnect();
    
    return res.json({
      success: true,
      message: `Joined group ${value} successfully`,
    });

  } catch (error) {
    console.error('JoinGroup error:', error);
    
    const errorMessage = error.message || '';
    if (errorMessage.includes('INVITE_HASH_INVALID')) {
      return res.status(400).json({ error: 'رابط الدعوة غير صالح' });
    }
    if (errorMessage.includes('INVITE_HASH_EXPIRED')) {
      return res.status(400).json({ error: 'رابط الدعوة منتهي الصلاحية' });
    }
    if (errorMessage.includes('USER_ALREADY_PARTICIPANT')) {
      return res.json({ success: true, message: 'Already a member' });
    }
    if (errorMessage.includes('USERS_TOO_MUCH')) {
      return res.status(400).json({ error: 'المجموعة ممتلئة' });
    }
    if (errorMessage.includes('CHANNELS_TOO_MUCH')) {
      return res.status(400).json({ error: 'وصلت للحد الأقصى من المجموعات' });
    }
    if (errorMessage.includes('FLOOD')) {
      return res.status(429).json({ error: 'تم تجاوز الحد المسموح. انتظر قبل المحاولة مرة أخرى' });
    }
    
    return res.status(500).json({ error: `خطأ في الانضمام: ${errorMessage}` });
  }
}

/**
 * Join a private group by invite link
 */
async function handleJoinPrivateGroup(params, res) {
  // Same as joinGroup, the parsing logic handles both
  return handleJoinGroup(params, res);
}

/**
 * Leave a group
 */
async function handleLeaveGroup({ sessionString, groupLink, apiId, apiHash }, res) {
  if (!sessionString || !groupLink) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const client = await getClientFromSession(sessionString, apiId || 123456, apiHash || 'demo');
    
    const { type, value } = parseGroupLink(groupLink);
    
    if (!value) {
      return res.status(400).json({ error: 'Invalid group link' });
    }
    
    console.log(`Leaving group: ${value}`);
    
    await client.invoke(
      new Api.channels.LeaveChannel({
        channel: value,
      })
    );
    
    await client.disconnect();
    
    return res.json({
      success: true,
      message: `Left group ${value} successfully`,
    });

  } catch (error) {
    console.error('LeaveGroup error:', error);
    
    const errorMessage = error.message || '';
    if (errorMessage.includes('USER_NOT_PARTICIPANT')) {
      return res.json({ success: true, message: 'Not a member' });
    }
    if (errorMessage.includes('CHANNEL_INVALID')) {
      return res.status(400).json({ error: 'المجموعة غير موجودة' });
    }
    
    return res.status(500).json({ error: `خطأ في المغادرة: ${errorMessage}` });
  }
}

/**
 * Get members from a group
 */
async function handleGetGroupMembers({ sessionString, groupLink, apiId, apiHash, limit, offset }, res) {
  if (!sessionString || !groupLink) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // IMPORTANT:
  // Railway/free proxies often have a hard request timeout (e.g. ~30s).
  // Fetching ALL members in one request can take minutes for large groups.
  // لذلك نعتمد pagination (limit/offset) حتى لا يعلق السيرفر ويرجع 502.

  const batchSize = Math.min(Math.max(parseInt(limit || 200, 10) || 200, 1), 200);
  const batchOffset = Math.max(parseInt(offset || 0, 10) || 0, 0);

  let client;

  try {
    client = await getClientFromSession(sessionString, apiId || 123456, apiHash || 'demo');

    const { value } = parseGroupLink(groupLink);

    if (!value) {
      return res.status(400).json({ error: 'Invalid group link' });
    }

    console.log(`Getting members batch from group: ${value} (offset=${batchOffset}, limit=${batchSize})`);

    // Get the channel/group entity
    const entity = await client.getEntity(value);

    const participants = await client.invoke(
      new Api.channels.GetParticipants({
        channel: entity,
        filter: new Api.ChannelParticipantsRecent({}),
        offset: batchOffset,
        limit: batchSize,
        hash: BigInt(0),
      })
    );

    const users = participants.users || [];

    const members = users.map((p) => ({
      id: p.id?.toString(),
      username: p.username || '',
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      phone: p.phone || '',
    })).filter((m) => Boolean(m.id));

    const hasMore = users.length === batchSize;
    const nextOffset = batchOffset + users.length;

    await client.disconnect();

    return res.json({
      success: true,
      members,
      count: members.length,
      offset: batchOffset,
      limit: batchSize,
      hasMore,
      nextOffset,
    });

  } catch (error) {
    console.error('GetGroupMembers error:', error);

    const errorMessage = error.message || '';
    if (errorMessage.includes('CHANNEL_PRIVATE')) {
      return res.status(400).json({ error: 'المجموعة خاصة ولا يمكن الوصول إليها' });
    }
    if (errorMessage.includes('CHAT_ADMIN_REQUIRED')) {
      return res.status(400).json({ error: 'يجب أن تكون مشرفاً لاستخراج الأعضاء' });
    }
    if (errorMessage.includes('FLOOD') || errorMessage.includes('PEER_FLOOD')) {
      return res.status(429).json({ error: 'تم تجاوز الحد المسموح. انتظر قبل المحاولة مرة أخرى' });
    }

    return res.status(500).json({ error: `خطأ في استخراج الأعضاء: ${errorMessage}` });
  } finally {
    try {
      if (client) await client.disconnect();
    } catch {}
  }
}

/**
 * Add a member to a group
 */
async function handleAddMemberToGroup({ sessionString, groupLink, userId, username, sourceGroup, apiId, apiHash }, res) {
  if (!sessionString || !groupLink || (!userId && !username)) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const client = await getClientFromSession(sessionString, apiId || 123456, apiHash || 'demo');
    
    const { type, value } = parseGroupLink(groupLink);
    
    if (!value) {
      return res.status(400).json({ error: 'Invalid group link' });
    }
    
    console.log(`Adding user ${username || userId} to group: ${value}`);
    
    // Get the channel entity first
    const channel = await client.getEntity(value);
    
    let userEntity;
    
    // Priority 1: Try username if available (most reliable)
    if (username && username.trim()) {
      try {
        userEntity = await client.getEntity(username);
        console.log(`Found user by username: ${username}`);
      } catch (e) {
        console.log(`Could not find user by username ${username}: ${e.message}`);
      }
    }
    
    // Priority 2: Try to get user from source group participants cache
    if (!userEntity && sourceGroup) {
      try {
        const { value: sourceValue } = parseGroupLink(sourceGroup);
        if (sourceValue) {
          const sourceChannel = await client.getEntity(sourceValue);
          // Get participants to cache the users
          const participants = await client.invoke(
            new Api.channels.GetParticipants({
              channel: sourceChannel,
              filter: new Api.ChannelParticipantsSearch({ q: '' }),
              offset: 0,
              limit: 200,
              hash: BigInt(0),
            })
          );
          
          // Find the user in participants
          const foundUser = participants.users.find(u => u.id.toString() === userId.toString());
          if (foundUser) {
            userEntity = foundUser;
            console.log(`Found user in source group participants: ${userId}`);
          }
        }
      } catch (e) {
        console.log(`Could not get user from source group: ${e.message}`);
      }
    }
    
    // Priority 3: Try direct ID access (may fail for unseen users)
    if (!userEntity && userId) {
      try {
        // Try using InputPeerUser with access_hash of 0 (sometimes works)
        userEntity = new Api.InputPeerUser({
          userId: BigInt(userId),
          accessHash: BigInt(0),
        });
        console.log(`Using InputPeerUser for userId: ${userId}`);
      } catch (e) {
        console.log(`Could not create InputPeerUser: ${e.message}`);
      }
    }
    
    if (!userEntity) {
      await client.disconnect();
      return res.status(400).json({ 
        error: 'لا يمكن العثور على المستخدم. تأكد من أن لديه username أو أنك عضو في نفس المجموعة' 
      });
    }
    
    // Add user to channel
    await client.invoke(
      new Api.channels.InviteToChannel({
        channel: channel,
        users: [userEntity],
      })
    );
    
    await client.disconnect();
    
    return res.json({
      success: true,
      message: `Added ${username || userId} to ${value}`,
    });

  } catch (error) {
    console.error('AddMemberToGroup error:', error);
    
    const errorMessage = error.message || '';
    if (errorMessage.includes('USER_PRIVACY_RESTRICTED')) {
      return res.status(400).json({ error: 'خصوصية المستخدم تمنع الإضافة' });
    }
    if (errorMessage.includes('USER_NOT_MUTUAL_CONTACT')) {
      return res.status(400).json({ error: 'يجب أن يكون المستخدم جهة اتصال متبادلة' });
    }
    if (errorMessage.includes('USER_ALREADY_PARTICIPANT')) {
      return res.json({ success: true, message: 'العضو موجود مسبقاً' });
    }
    if (errorMessage.includes('PEER_FLOOD')) {
      return res.status(429).json({ error: 'تم تجاوز الحد المسموح. انتظر قبل المحاولة' });
    }
    if (errorMessage.includes('CHAT_ADMIN_REQUIRED') || errorMessage.includes('CHAT_WRITE_FORBIDDEN')) {
      return res.status(400).json({ error: 'يجب أن تكون مشرفاً للإضافة' });
    }
    if (errorMessage.includes('Could not find the input entity')) {
      return res.status(400).json({ error: 'لا يمكن العثور على المستخدم. يجب أن يكون لديه username' });
    }
    
    return res.status(500).json({ error: `خطأ في الإضافة: ${errorMessage}` });
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
