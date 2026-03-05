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
app.use(express.json({ limit: '50mb' }));

// Store active sessions in memory (use Redis for production)
const activeSessions = new Map();

// Store active monitoring sessions
const activeMonitors = new Map(); // monitorId -> { clients, handlers, supabaseUrl, supabaseKey, sessionId }

// Store active batch-add jobs
const activeBatchJobs = new Map(); // jobId -> { ... }

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Telegram MTProto Server is running',
    version: '2.3.0',
    activeMonitors: activeMonitors.size,
    activeBatchJobs: activeBatchJobs.size,
  });
});

// Self-ping keep-alive: prevents Railway from killing the server due to idle timeout
// Pings itself every 4 minutes (Railway idle timeout is typically 5 min)
let selfPingInterval = null;
function startSelfPing() {
  if (selfPingInterval) return;
  const serverUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${PORT}`;
  
  selfPingInterval = setInterval(async () => {
    if (activeMonitors.size === 0 && activeBatchJobs.size === 0) {
      // No active work, stop self-pinging
      clearInterval(selfPingInterval);
      selfPingInterval = null;
      console.log('[KeepAlive] No active tasks, stopped self-ping');
      return;
    }
    try {
      await fetch(serverUrl);
      console.log(`[KeepAlive] Self-ping OK (monitors: ${activeMonitors.size}, jobs: ${activeBatchJobs.size})`);
    } catch (e) {
      console.log(`[KeepAlive] Self-ping failed: ${e.message}`);
    }
  }, 4 * 60 * 1000); // every 4 minutes
  console.log(`[KeepAlive] Started self-ping to ${serverUrl}`);
}


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
      case 'startMonitoring':
        return await handleStartMonitoring(params, res);
      case 'stopMonitoring':
        return await handleStopMonitoring(params, res);
      case 'getMonitoringStatus':
        return await handleGetMonitoringStatus(params, res);
      case 'startBatchAdd':
        return await handleStartBatchAdd(params, res);
      case 'stopBatchAdd':
        return await handleStopBatchAdd(params, res);
      case 'pauseBatchAdd':
        return await handlePauseBatchAdd(params, res);
      case 'getBatchAddStatus':
        return await handleGetBatchAddStatus(params, res);
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
    
    let resolvedChatId = null;
    let resolvedTitle = null;
    
    if (type === 'hash') {
      // Private group - use import invite
      const result = await client.invoke(
        new Api.messages.ImportChatInvite({
          hash: value,
        })
      );
      // Extract chat ID from the result
      if (result?.chats?.length > 0) {
        const chat = result.chats[0];
        resolvedChatId = chat.id?.value !== undefined ? `-100${chat.id.value}` : (chat.id ? `-100${chat.id}` : null);
        resolvedTitle = chat.title;
      }
    } else {
      // Public group - join by username
      await client.invoke(
        new Api.channels.JoinChannel({
          channel: value,
        })
      );
      // Resolve chatId for public groups too
      try {
        const ent = await client.getEntity(value);
        if (ent) {
          resolvedChatId = ent.id?.value !== undefined ? `-100${ent.id.value}` : (ent.id ? `-100${ent.id}` : null);
          resolvedTitle = ent.title || null;
        }
      } catch (e) {
        console.log(`Could not resolve public group entity: ${e.message}`);
      }
    }
    
    await client.disconnect();
    
    return res.json({
      success: true,
      message: `Joined group ${value} successfully`,
      chatId: resolvedChatId,
      chatTitle: resolvedTitle,
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
      // Try to resolve the chat to get the ID even if already joined
      let resolvedChatId = null;
      try {
        const client2 = await getClientFromSession(sessionString, apiId || 123456, apiHash || 'demo');
        // For invite hash, use CheckChatInvite to get info
        const { type: t2, value: v2 } = parseGroupLink(groupLink);
        if (t2 === 'hash') {
          const checkResult = await client2.invoke(new Api.messages.CheckChatInvite({ hash: v2 }));
          if (checkResult?.chat) {
            const c = checkResult.chat;
            resolvedChatId = c.id?.value !== undefined ? `-100${c.id.value}` : (c.id ? `-100${c.id}` : null);
          }
        }
        await client2.disconnect();
      } catch (e) { /* ignore */ }
      return res.json({ success: true, message: 'Already a member', chatId: resolvedChatId });
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
async function handleGetGroupMembers({ sessionString, groupLink, chatId, apiId, apiHash, searchQuery: singleQuery, knownIds }, res) {
  if (!sessionString || (!groupLink && !chatId)) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // Full list of search queries for exhaustive extraction
  const ALL_QUERIES = [
    '', 'a','b','c','d','e','f','g','h','i','j','k','l','m',
    'n','o','p','q','r','s','t','u','v','w','x','y','z',
    '0','1','2','3','4','5','6','7','8','9',
    'ا','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش',
    'ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و','ي',
  ];

  let client;

  try {
    client = await getClientFromSession(sessionString, apiId || 123456, apiHash || 'demo');

    let entity;
    if (chatId) {
      // Prefer resolving by groupLink first (more reliable for private groups)
      if (groupLink) {
        const { type, value } = parseGroupLink(groupLink);
        if (value) {
          try {
            if (type === 'hash') {
              try {
                const joinResult = await client.invoke(new Api.messages.ImportChatInvite({ hash: value }));
                if (joinResult?.chats?.length > 0) {
                  entity = joinResult.chats[0];
                  console.log(`Resolved by invite import: ${entity.title || entity.id}`);
                }
              } catch (e) {
                const msg = e.message || '';
                if (!msg.includes('USER_ALREADY_PARTICIPANT')) {
                  console.log(`ImportChatInvite resolve failed: ${msg}`);
                }
              }

              if (!entity) {
                try {
                  const checkResult = await client.invoke(new Api.messages.CheckChatInvite({ hash: value }));
                  if (checkResult?.chat) {
                    entity = checkResult.chat;
                    console.log(`Resolved by CheckChatInvite: ${entity.title || entity.id}`);
                  }
                } catch (e) {
                  console.log(`CheckChatInvite resolve failed: ${e.message}`);
                }
              }
            } else {
              entity = await client.getEntity(value);
              if (entity) console.log(`Resolved by groupLink username: ${entity.title || entity.id}`);
            }
          } catch (e) {
            console.log(`groupLink resolve failed: ${e.message}`);
          }
        }
      }

      // Fallback: search dialogs using chatId
      if (!entity) {
        const rawId = chatId.toString().replace('-100', '');
        console.log(`Resolving entity by chatId via dialogs: ${chatId} (raw: ${rawId})`);
        const dialogs = await client.getDialogs({ limit: 200 });
        for (const d of dialogs) {
          if (d.entity && (d.isChannel || d.isGroup)) {
            const dId = d.entity.id?.value !== undefined ? d.entity.id.value.toString() : d.entity.id?.toString();
            if (dId === rawId) {
              entity = d.entity;
              console.log(`Found entity in dialogs: ${entity.title || entity.id}`);
              break;
            }
          }
        }
      }

      if (!entity) {
        return res.status(400).json({ error: 'تعذر العثور على المجموعة بمعرفها' });
      }
    } else {
      const { type, value } = parseGroupLink(groupLink);
      if (!value) {
        return res.status(400).json({ error: 'Invalid group link' });
      }
      
      if (type === 'hash') {
        // Private group - first join, then resolve from dialogs
        console.log(`Private group hash detected: ${value}`);
        
        // Try joining first (will throw USER_ALREADY_PARTICIPANT if already in)
        try {
          const joinResult = await client.invoke(new Api.messages.ImportChatInvite({ hash: value }));
          if (joinResult?.chats?.length > 0) {
            entity = joinResult.chats[0];
            console.log(`Joined and resolved: ${entity.title} (ID: ${entity.id})`);
          }
        } catch (joinErr) {
          const errMsg = joinErr.message || '';
          if (!errMsg.includes('USER_ALREADY_PARTICIPANT')) {
            console.error('Join error during extraction:', errMsg);
          } else {
            console.log('Already a participant, resolving via CheckChatInvite...');
          }
        }
        
        // If join didn't give us entity, try CheckChatInvite
        if (!entity) {
          try {
            const checkResult = await client.invoke(new Api.messages.CheckChatInvite({ hash: value }));
            // ChatInviteAlready has the chat object
            entity = checkResult?.chat || null;
            if (entity) {
              console.log(`CheckChatInvite resolved: ${entity.title} (ID: ${entity.id})`);
            }
          } catch (e) {
            console.log(`CheckChatInvite failed: ${e.message}`);
          }
        }
        
        // Final fallback: search all dialogs
        if (!entity) {
          console.log('Searching dialogs for the private group...');
          const dialogs = await client.getDialogs({ limit: 100 });
          for (const d of dialogs) {
            if (d.isChannel || d.isGroup) {
              entity = d.entity;
              console.log(`Using first group from dialogs: ${entity.title}`);
              break;
            }
          }
        }
        
        if (!entity) {
          return res.status(400).json({ error: 'تعذر العثور على المجموعة الخاصة' });
        }
      } else {
        entity = await client.getEntity(value);
      }
    }

    // If singleQuery is provided, only process that one query letter
    // Otherwise return the list of queries for the client to iterate
    if (singleQuery === undefined || singleQuery === null) {
      // Return the query plan so the client knows what to iterate
      // Also do the first empty-string query
      const firstQuery = '';
      const members = await extractForQuery(client, entity, firstQuery, new Set(knownIds || []));
      await client.disconnect();

      return res.json({
        success: true,
        members,
        count: members.length,
        currentQuery: firstQuery,
        remainingQueries: ALL_QUERIES.slice(1), // everything after ''
        hasMore: true,
      });
    }

    // Process a single search query
    const skipIds = new Set(knownIds || []);
    const members = await extractForQuery(client, entity, singleQuery, skipIds);
    await client.disconnect();

    return res.json({
      success: true,
      members,
      count: members.length,
      currentQuery: singleQuery,
      hasMore: false, // client manages the queue
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
 * Extract members for a single search query prefix
 */
async function extractForQuery(client, entity, q, skipIds) {
  const members = [];
  let searchOffset = 0;
  const batchSize = 200;

  while (true) {
    try {
      const participants = await client.invoke(
        new Api.channels.GetParticipants({
          channel: entity,
          filter: new Api.ChannelParticipantsSearch({ q }),
          offset: searchOffset,
          limit: batchSize,
          hash: BigInt(0),
        })
      );

      const users = participants.users || [];
      if (users.length === 0) break;

      for (const p of users) {
        const id = p.id?.toString();
        if (id && !skipIds.has(id)) {
          skipIds.add(id);
          members.push({
            id,
            username: p.username || '',
            firstName: p.firstName || '',
            lastName: p.lastName || '',
            phone: p.phone || '',
            accessHash: p.accessHash?.toString() || '',
          });
        }
      }

      if (users.length < batchSize) break;
      searchOffset += users.length;

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('FLOOD')) {
        const waitMatch = msg.match(/FLOOD_WAIT[_\s]*(\d+)/i);
        const waitSec = waitMatch ? parseInt(waitMatch[1]) : 5;
        console.log(`FLOOD_WAIT ${waitSec}s during search q="${q}", waiting...`);
        await new Promise(r => setTimeout(r, (waitSec + 1) * 1000));
        continue; // Retry instead of breaking
      }
      break;
    }
  }

  console.log(`Query "${q}": found ${members.length} new members`);
  return members;
}

/**
 * Add a member to a group - simplified Pyrogram-inspired logic
 */
async function handleAddMemberToGroup({ sessionString, groupLink, userId, username, sourceGroup, accessHash, apiId, apiHash }, res) {
  if (!sessionString || !groupLink || (!userId && !username)) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  let client;
  try {
    client = await getClientFromSession(sessionString, apiId || 123456, apiHash || 'demo');
    
    const { type, value } = parseGroupLink(groupLink);
    if (!value) {
      await client.disconnect();
      return res.status(400).json({ error: 'Invalid group link' });
    }
    
    console.log(`[ADD] user=${username || userId} → group=${value}`);
    
    // ===== STEP 1: Resolve target group =====
    let targetEntity;
    try {
      if (type === 'hash') {
        // Private group - resolve strictly by invite hash only (no random dialog fallback)
        try {
          const checkResult = await client.invoke(new Api.messages.CheckChatInvite({ hash: value }));
          if (checkResult?.chat) {
            targetEntity = checkResult.chat;
          }
        } catch (e) {
          try {
            const joinResult = await client.invoke(new Api.messages.ImportChatInvite({ hash: value }));
            if (joinResult?.chats?.length > 0) {
              targetEntity = joinResult.chats[0];
            }
          } catch (je) {
            const joinMsg = je.message || '';
            console.log(`[ADD] Invite hash resolve/import failed: ${joinMsg}`);
          }
        }
      } else {
        targetEntity = await client.getEntity(value);
      }
    } catch (e) {
      console.log(`[ADD] Failed to resolve target: ${e.message}`);
    }
    
    if (!targetEntity) {
      await client.disconnect();
      return res.status(400).json({ error: `لا يمكن الوصول للمجموعة: ${value}` });
    }
    
    const isChannel = targetEntity.className === 'Channel';
    const isChat = targetEntity.className === 'Chat';
    console.log(`[ADD] Target: ${targetEntity.title} (${targetEntity.className}, megagroup=${targetEntity.megagroup})`);
    
    // ===== STEP 2: Resolve user entity =====
    // Like Pyrogram: simplest approach - try username first, then source group search
    let userEntity;
    
    // Method 1: Username (most reliable - Pyrogram uses this internally)
    if (!userEntity && username && username.trim()) {
      const cleanUsername = username.trim().replace('@', '');
      try {
        const resolved = await client.invoke(new Api.contacts.ResolveUsername({ username: cleanUsername }));
        if (resolved?.users?.length > 0) {
          userEntity = resolved.users[0];
          console.log(`[ADD] Resolved by username: @${cleanUsername} → id=${userEntity.id}`);
        }
      } catch (e) {
        console.log(`[ADD] Username resolve failed: ${e.message}`);
      }
    }
    
    // Method 2: Search in source group (like Pyrogram's get_chat_members)
    if (!userEntity && sourceGroup && userId) {
      try {
        const { type: sType, value: sValue } = parseGroupLink(sourceGroup);
        if (sValue) {
          let sourceEntity;
          if (sType === 'hash') {
            try {
              const checkResult = await client.invoke(new Api.messages.CheckChatInvite({ hash: sValue }));
              if (checkResult?.chat) sourceEntity = checkResult.chat;
            } catch (e) { /* ignore */ }
          } else {
            sourceEntity = await client.getEntity(sValue);
          }
          
          if (sourceEntity) {
            // Search with empty query to scan participants
            const participants = await client.invoke(
              new Api.channels.GetParticipants({
                channel: sourceEntity,
                filter: new Api.ChannelParticipantsSearch({ q: '' }),
                offset: 0,
                limit: 200,
                hash: BigInt(0),
              })
            );
            let found = participants.users?.find(u => u.id?.toString() === userId.toString());
            if (!found && username) {
              // Try searching by username prefix
              const p2 = await client.invoke(
                new Api.channels.GetParticipants({
                  channel: sourceEntity,
                  filter: new Api.ChannelParticipantsSearch({ q: username.substring(0, 5) }),
                  offset: 0,
                  limit: 200,
                  hash: BigInt(0),
                })
              );
              found = p2.users?.find(u => u.id?.toString() === userId.toString());
            }
            if (found) {
              userEntity = found;
              console.log(`[ADD] Found in source group: id=${found.id}, accessHash=${found.accessHash}`);
            }
          }
        }
      } catch (e) {
        console.log(`[ADD] Source group search failed: ${e.message}`);
      }
    }
    
    // Method 3: Use stored accessHash as last resort
    if (!userEntity && userId && accessHash && accessHash !== '0' && accessHash !== '') {
      try {
        userEntity = new Api.InputPeerUser({
          userId: BigInt(userId),
          accessHash: BigInt(accessHash),
        });
        console.log(`[ADD] Using stored accessHash for ${userId}`);
      } catch (e) {
        console.log(`[ADD] InputPeerUser failed: ${e.message}`);
      }
    }
    
    if (!userEntity) {
      await client.disconnect();
      return res.status(400).json({ error: 'لا يمكن التعرف على المستخدم - لا يوجد username أو accessHash صالح' });
    }
    
    // Build InputUser
    let inputUser;
    if (userEntity.className === 'User') {
      inputUser = new Api.InputUser({
        userId: userEntity.id,
        accessHash: userEntity.accessHash || BigInt(0),
      });
    } else if (userEntity.className === 'InputPeerUser') {
      inputUser = new Api.InputUser({
        userId: userEntity.userId,
        accessHash: userEntity.accessHash || BigInt(0),
      });
    } else {
      inputUser = userEntity;
    }
    
    // ===== STEP 3: Add member (like Pyrogram's add_chat_members) =====
    let result;
    // ===== STEP 3: Add member with retry on FLOOD_WAIT =====
    const MAX_FLOOD_RETRIES = 3;
    let lastError = null;
    
    for (let attempt = 0; attempt <= MAX_FLOOD_RETRIES; attempt++) {
      try {
        let result;
        if (isChat) {
          console.log(`[ADD] Using AddChatUser (basic group)${attempt > 0 ? ` retry #${attempt}` : ''}`);
          result = await client.invoke(
            new Api.messages.AddChatUser({
              chatId: targetEntity.id,
              userId: inputUser,
              fwdLimit: 100,
            })
          );
        } else {
          console.log(`[ADD] Using InviteToChannel (supergroup/channel)${attempt > 0 ? ` retry #${attempt}` : ''}`);
          result = await client.invoke(
            new Api.channels.InviteToChannel({
              channel: targetEntity,
              users: [inputUser],
            })
          );
        }
        
        // No error thrown = success (Pyrogram behavior - trust the API)
        // Don't check missingInvitees - just trust InviteToChannel result
        await client.disconnect();
        console.log(`[ADD] ✅ Success: ${username || userId} → ${targetEntity.title}`);
        return res.json({ success: true, message: `تمت إضافة ${username || userId}` });
        
      } catch (error) {
        const errorMessage = error.message || '';
        
        // Handle FLOOD_WAIT on server side - sleep and retry
        if (errorMessage.includes('FLOOD_WAIT')) {
          const waitMatch = errorMessage.match(/FLOOD_WAIT[_\s]*(\d+)/i);
          const waitSec = waitMatch ? parseInt(waitMatch[1]) : 60;
          
          if (attempt < MAX_FLOOD_RETRIES) {
            console.log(`[ADD] FLOOD_WAIT ${waitSec}s - sleeping on server (attempt ${attempt + 1}/${MAX_FLOOD_RETRIES})...`);
            await new Promise(r => setTimeout(r, (waitSec + 1) * 1000));
            continue; // Retry after sleep
          } else {
            // Exhausted retries, return flood error to client
            await client.disconnect();
            return res.json({ success: false, error: `تم تجاوز الحد - انتظر ${waitSec} ثانية`, floodWait: waitSec });
          }
        }
        
        // For PEER_FLOOD (softer rate limit), also sleep and retry
        if (errorMessage.includes('PEER_FLOOD')) {
          if (attempt < MAX_FLOOD_RETRIES) {
            const waitSec = 30 * (attempt + 1); // 30s, 60s, 90s
            console.log(`[ADD] PEER_FLOOD - sleeping ${waitSec}s (attempt ${attempt + 1}/${MAX_FLOOD_RETRIES})...`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
            continue;
          } else {
            await client.disconnect();
            return res.json({ success: false, error: `تم تجاوز الحد - حاول لاحقاً`, floodWait: 60 });
          }
        }
        
        // Non-retryable errors - return immediately
        lastError = errorMessage;
        break;
      }
    }
    
    // Handle non-retryable errors
    if (client) { try { await client.disconnect(); } catch (_) {} }
    const errorMessage = lastError || '';
    console.error(`[ADD] Error: ${errorMessage}`);
    
    if (errorMessage.includes('USER_PRIVACY_RESTRICTED'))
      return res.json({ success: false, error: 'خصوصية المستخدم تمنع الإضافة' });
    if (errorMessage.includes('USER_NOT_MUTUAL_CONTACT'))
      return res.json({ success: false, error: 'يجب أن يكون جهة اتصال متبادلة' });
    if (errorMessage.includes('USER_ALREADY_PARTICIPANT'))
      return res.json({ success: false, alreadyParticipant: true, error: 'العضو موجود مسبقاً' });
    if (errorMessage.includes('CHAT_ADMIN_REQUIRED') || errorMessage.includes('CHAT_WRITE_FORBIDDEN'))
      return res.json({ success: false, error: 'ليس لديك صلاحية الإضافة - يجب أن تكون مشرفاً', isNotAdmin: true });
    if (errorMessage.includes('USER_ID_INVALID') || errorMessage.includes('Could not find the input entity'))
      return res.json({ success: false, error: 'لا يمكن التعرف على المستخدم' });
    if (errorMessage.includes('USER_CHANNELS_TOO_MUCH'))
      return res.json({ success: false, error: 'العضو في أكثر من 500 مجموعة' });
    if (errorMessage.includes('USER_BANNED_IN_CHANNEL'))
      return res.json({ success: false, error: 'العضو محظور من هذه المجموعة' });
    if (errorMessage.includes('USER_KICKED'))
      return res.json({ success: false, error: 'العضو مطرود من هذه المجموعة' });
    if (errorMessage.includes('USERS_TOO_MUCH'))
      return res.json({ success: false, error: 'المجموعة وصلت للحد الأقصى' });
    if (errorMessage.includes('INPUT_USER_DEACTIVATED'))
      return res.json({ success: false, error: 'حساب المستخدم محذوف' });
    if (errorMessage.includes('PEER_ID_INVALID'))
      return res.json({ success: false, error: 'معرف المستخدم غير صالح' });
    
    return res.json({ success: false, error: `خطأ في الإضافة: ${errorMessage}` });
  } catch (outerError) {
    // Catch any unexpected errors in the entire function
    if (client) { try { await client.disconnect(); } catch (_) {} }
    const msg = outerError.message || 'خطأ غير متوقع';
    console.error(`[ADD] Outer error: ${msg}`);
    return res.json({ success: false, error: `خطأ في الإضافة: ${msg}` });
  }
}

/**
 * Start monitoring groups for new messages
 * Connects accounts to groups and listens for messages in real-time
 */
async function handleStartMonitoring({ accounts, groups, sessionId, supabaseUrl, supabaseKey, targetGroup }, res) {
  if (!accounts || !accounts.length || !groups || !groups.length || !sessionId || !supabaseUrl || !supabaseKey) {
    return res.status(400).json({ error: 'Missing required parameters: accounts, groups, sessionId, supabaseUrl, supabaseKey' });
  }

  // Stop existing monitor with same sessionId if any
  if (activeMonitors.has(sessionId)) {
    await stopMonitor(sessionId);
  }

  const monitor = {
    clients: [],
    sessionId,
    supabaseUrl,
    supabaseKey,
    groups: groups,
    targetGroup: targetGroup || null,
    startedAt: Date.now(),
    membersFound: 0,
    membersAdded: 0,
    membersFailed: 0,
    errors: [],
    resolvedChatIds: new Set(),
    stopRequested: false,
    addQueue: [],
  };

  console.log(`[Monitor ${sessionId}] Starting monitoring for ${groups.length} groups with ${accounts.length} accounts`);

  // Helper: store member in Supabase AND queue for auto-add
  const storeMember = async (memberData) => {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/monitored_members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'resolution=ignore-duplicates',
        },
        body: JSON.stringify(memberData),
      });
      
      if (response.ok || response.status === 201) {
        monitor.membersFound++;
        // Queue for auto-add if target group set
        if (monitor.targetGroup && memberData.telegram_user_id) {
          monitor.addQueue.push({
            userId: memberData.telegram_user_id,
            username: memberData.username,
            accessHash: memberData.access_hash,
            sourceGroup: memberData.source_group,
          });
        }
        if (monitor.membersFound % 50 === 0) {
          fetch(`${supabaseUrl}/rest/v1/monitoring_sessions?id=eq.${sessionId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ total_members_found: monitor.membersFound }),
          }).catch(() => {});
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error(`[Monitor ${sessionId}] DB store error: ${e.message}`);
      return false;
    }
  };

  // === Auto-add worker: processes queue and adds members to target group ===
  const startAutoAddWorker = async (addClient) => {
    console.log(`[Monitor ${sessionId}] Auto-add worker started for target: ${monitor.targetGroup}`);
    const { type: tType, value: tValue } = parseGroupLink(monitor.targetGroup);
    if (!tValue) { monitor.errors.push('رابط المجموعة الهدف غير صالح'); return; }

    let targetEntity;
    try {
      if (tType === 'hash') {
        // Check first to avoid FLOOD_WAIT
        try {
          const cr = await addClient.invoke(new Api.messages.CheckChatInvite({ hash: tValue }));
          targetEntity = cr?.chat || null;
        } catch (e) {
          try {
            const jr = await addClient.invoke(new Api.messages.ImportChatInvite({ hash: tValue }));
            if (jr?.chats?.length > 0) targetEntity = jr.chats[0];
          } catch (je) {
            if (je.message?.includes('USER_ALREADY_PARTICIPANT')) {
              try { const cr2 = await addClient.invoke(new Api.messages.CheckChatInvite({ hash: tValue })); targetEntity = cr2?.chat || null; } catch (_) {}
            } else if (je.message?.includes('FLOOD_WAIT')) {
              const ws = (je.message.match(/(\d+)/)?.[1]) || '60';
              await new Promise(r => setTimeout(r, (parseInt(ws) + 2) * 1000));
              try { const jr2 = await addClient.invoke(new Api.messages.ImportChatInvite({ hash: tValue })); if (jr2?.chats?.length > 0) targetEntity = jr2.chats[0]; } catch (re) {
                if (re.message?.includes('USER_ALREADY_PARTICIPANT')) { try { const cr3 = await addClient.invoke(new Api.messages.CheckChatInvite({ hash: tValue })); targetEntity = cr3?.chat || null; } catch (_) {} }
              }
            } else { throw je; }
          }
        }
      } else {
        try { targetEntity = await addClient.getEntity(tValue); } catch (e) {
          try { await addClient.invoke(new Api.channels.JoinChannel({ channel: tValue })); } catch (_) {}
          targetEntity = await addClient.getEntity(tValue);
        }
      }
    } catch (e) {
      monitor.errors.push(`فشل الوصول للمجموعة الهدف: ${e.message}`);
      return;
    }
    if (!targetEntity) { monitor.errors.push('تعذر تحديد المجموعة الهدف'); return; }
    console.log(`[Monitor ${sessionId}] Target resolved: ${targetEntity.title || tValue}`);

    const addedIds = new Set();
    while (!monitor.stopRequested && activeMonitors.has(sessionId)) {
      if (monitor.addQueue.length === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
      const member = monitor.addQueue.shift();
      if (!member || addedIds.has(member.userId)) continue;
      addedIds.add(member.userId);

      try {
        let userEntity = null;
        if (member.username) { try { userEntity = await addClient.getEntity(member.username); } catch (e) {} }
        if (!userEntity && member.accessHash && member.accessHash !== '0') {
          try { userEntity = new Api.InputPeerUser({ userId: BigInt(member.userId), accessHash: BigInt(member.accessHash) }); } catch (e) {}
        }
        if (!userEntity) { monitor.membersFailed++; continue; }

        await addClient.invoke(new Api.channels.InviteToChannel({ channel: targetEntity, users: [userEntity] }));
        monitor.membersAdded++;
        console.log(`[Monitor ${sessionId}] ✅ Added ${member.username || member.userId} (total: ${monitor.membersAdded})`);
        await new Promise(r => setTimeout(r, 5000)); // 5s cooldown
      } catch (err) {
        const msg = err.message || '';
        if (msg.includes('USER_ALREADY_PARTICIPANT')) { /* skip */ }
        else if (msg.includes('FLOOD_WAIT')) {
          const ws = (msg.match(/FLOOD_WAIT[_\s]*(\d+)/i) || [])[1] || '60';
          console.log(`[Monitor ${sessionId}] FLOOD_WAIT ${ws}s auto-add`);
          monitor.addQueue.unshift(member); addedIds.delete(member.userId);
          await new Promise(r => setTimeout(r, (parseInt(ws) + 1) * 1000));
        } else if (msg.includes('CHAT_ADMIN_REQUIRED') || msg.includes('CHAT_WRITE_FORBIDDEN')) {
          monitor.errors.push('الحساب ليس مشرفاً في المجموعة الهدف'); return;
        } else if (msg.includes('USER_PRIVACY_RESTRICTED') || msg.includes('USER_NOT_MUTUAL_CONTACT') || msg.includes('INPUT_USER_DEACTIVATED') || msg.includes('USER_BANNED') || msg.includes('USER_KICKED')) {
          monitor.membersFailed++;
        } else { monitor.membersFailed++; console.log(`[Monitor ${sessionId}] Add err: ${msg}`); }
      }
    }
  };

  // Distribute groups across accounts
  const connectedClients = [];
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    try {
      const client = await getClientFromSession(
        account.sessionString, 
        account.apiId || 123456, 
        account.apiHash || 'demo'
      );
      
      // Assign groups to this account
      const assignedGroups = [];
      for (let g = 0; g < groups.length; g++) {
        if (g % accounts.length === i) {
          assignedGroups.push(groups[g]);
        }
      }

      const resolvedEntities = []; // { entity, groupLink, title }

      // Join each group and resolve entity
      for (const groupLink of assignedGroups) {
        try {
          const { type, value } = parseGroupLink(groupLink);
          let entity = null;

          if (type === 'hash') {
            // Try CheckChatInvite first to avoid FLOOD_WAIT if already joined
            try {
              const checkResult = await client.invoke(new Api.messages.CheckChatInvite({ hash: value }));
              entity = checkResult?.chat || null;
              if (entity) {
                console.log(`[Monitor ${sessionId}] Already in group (hash), resolved via CheckChatInvite`);
              }
            } catch (e) {
              // If check fails, try joining
              try {
                const joinResult = await client.invoke(new Api.messages.ImportChatInvite({ hash: value }));
                if (joinResult?.chats?.length > 0) entity = joinResult.chats[0];
              } catch (je) {
                if (je.message?.includes('USER_ALREADY_PARTICIPANT')) {
                  // Already in, try resolving again
                  try {
                    const cr2 = await client.invoke(new Api.messages.CheckChatInvite({ hash: value }));
                    entity = cr2?.chat || null;
                  } catch (_) {}
                } else if (je.message?.includes('FLOOD_WAIT') || je.message?.includes('wait')) {
                  const ws = (je.message.match(/(\d+)/)?.[1]) || '60';
                  console.log(`[Monitor ${sessionId}] FLOOD_WAIT ${ws}s joining ${groupLink}, waiting...`);
                  await new Promise(r => setTimeout(r, (parseInt(ws) + 2) * 1000));
                  // Retry once after wait
                  try {
                    const jr2 = await client.invoke(new Api.messages.ImportChatInvite({ hash: value }));
                    if (jr2?.chats?.length > 0) entity = jr2.chats[0];
                  } catch (re) {
                    if (re.message?.includes('USER_ALREADY_PARTICIPANT')) {
                      try { const cr3 = await client.invoke(new Api.messages.CheckChatInvite({ hash: value })); entity = cr3?.chat || null; } catch (_) {}
                    } else { throw re; }
                  }
                } else { throw je; }
              }
            }
          } else {
            try {
              entity = await client.getEntity(value);
              console.log(`[Monitor ${sessionId}] Already resolved public group: ${value}`);
            } catch (e) {
              // Not resolved, try joining
              try {
                await client.invoke(new Api.channels.JoinChannel({ channel: value }));
              } catch (je) {
                if (!je.message?.includes('USER_ALREADY_PARTICIPANT')) {
                  if (je.message?.includes('FLOOD_WAIT')) {
                    const ws = (je.message.match(/(\d+)/)?.[1]) || '60';
                    await new Promise(r => setTimeout(r, (parseInt(ws) + 2) * 1000));
                    try { await client.invoke(new Api.channels.JoinChannel({ channel: value })); } catch (_) {}
                  } else { throw je; }
                }
              }
              try { entity = await client.getEntity(value); } catch (_) {}
            }
          }

          if (entity) {
            const chatId = entity.id?.value !== undefined ? entity.id.value.toString() : entity.id?.toString();
            if (chatId) monitor.resolvedChatIds.add(chatId);
            resolvedEntities.push({ entity, groupLink, title: entity.title || value });
            console.log(`[Monitor ${sessionId}] Account ${account.phone} joined ${groupLink} (ID: ${chatId})`);
          } else {
            console.error(`[Monitor ${sessionId}] Could not resolve entity for ${groupLink}`);
            monitor.errors.push(`فشل تحديد مجموعة ${groupLink}`);
          }
        } catch (joinErr) {
          console.error(`[Monitor ${sessionId}] Failed to join ${groupLink}: ${joinErr.message}`);
          monitor.errors.push(`فشل انضمام ${account.phone} لـ ${groupLink}: ${joinErr.message}`);
        }
      }

      // === PHASE 2: Set up real-time message handler immediately ===
      const { NewMessage } = require('telegram/events');
      const chatEntities = resolvedEntities.map(r => r.entity);

      const handler = async (event) => {
        try {
          const message = event.message;
          if (!message || !message.senderId) return;

          const senderId = message.senderId.toString();

          let senderUsername = null;
          let senderFirstName = null;
          let senderLastName = null;
          let senderAccessHash = null;
          let sourceGroup = null;

          try {
            const sender = await message.getSender();
            if (sender) {
              if (sender.bot) return; // Skip bots
              senderUsername = sender.username || null;
              senderFirstName = sender.firstName || null;
              senderLastName = sender.lastName || null;
              senderAccessHash = sender.accessHash ? sender.accessHash.toString() : null;
            }
          } catch (e) {}

          try {
            const chat = await message.getChat();
            if (chat) {
              sourceGroup = chat.title || chat.username || null;
            }
          } catch (e) {}

          const stored = await storeMember({
            session_id: sessionId,
            telegram_user_id: senderId,
            username: senderUsername,
            first_name: senderFirstName,
            last_name: senderLastName,
            access_hash: senderAccessHash,
            source_group: sourceGroup,
            message_text: (message.text || '').substring(0, 200),
          });

          if (stored) {
            console.log(`[Monitor ${sessionId}] New member from message: ${senderUsername || senderId} in ${sourceGroup}`);
          }
        } catch (handlerErr) {
          console.error(`[Monitor ${sessionId}] Handler error: ${handlerErr.message}`);
        }
      };

      client.addEventHandler(handler, new NewMessage({ chats: chatEntities }));
      connectedClients.push({ client, phone: account.phone, handler, assignedGroups });
      console.log(`[Monitor ${sessionId}] Account ${account.phone} connected and listening to ${chatEntities.length} groups ONLY`);

      // === PHASE 1 (background): CONTINUOUS extraction loop - keeps running until stopped ===
      const runContinuousExtraction = async () => {
        let cycleCount = 0;
        while (!monitor.stopRequested && activeMonitors.has(sessionId)) {
          cycleCount++;
          console.log(`[Monitor ${sessionId}] Starting extraction cycle #${cycleCount} for account ${account.phone}`);

          for (const { entity, title } of resolvedEntities) {
            if (monitor.stopRequested || !activeMonitors.has(sessionId)) return;

            console.log(`[Monitor ${sessionId}] Cycle #${cycleCount}: Extracting from "${title}"...`);
            let extractedCount = 0;

            const searchQueries = [
              '', 'a','b','c','d','e','f','g','h','i','j','k','l','m',
              'n','o','p','q','r','s','t','u','v','w','x','y','z',
              '0','1','2','3','4','5','6','7','8','9',
              'ا','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش',
              'ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و','ي',
            ];

            for (const q of searchQueries) {
              if (monitor.stopRequested || !activeMonitors.has(sessionId)) return;
              let offset = 0;

              while (true) {
                if (monitor.stopRequested || !activeMonitors.has(sessionId)) return;
                try {
                  const participants = await client.invoke(
                    new Api.channels.GetParticipants({
                      channel: entity,
                      filter: new Api.ChannelParticipantsSearch({ q }),
                      offset,
                      limit: 200,
                      hash: BigInt(0),
                    })
                  );

                  const users = participants.users || [];
                  if (users.length === 0) break;

                  for (const u of users) {
                    const uid = u.id?.toString();
                    if (uid && !u.bot) {
                      const stored = await storeMember({
                        session_id: sessionId,
                        telegram_user_id: uid,
                        username: u.username || null,
                        first_name: u.firstName || null,
                        last_name: u.lastName || null,
                        access_hash: u.accessHash ? u.accessHash.toString() : null,
                        source_group: title,
                        message_text: null,
                      });
                      if (stored) extractedCount++;
                    }
                  }

                  if (users.length < 200) break;
                  offset += users.length;
                  await new Promise(r => setTimeout(r, 300));
                } catch (err) {
                  const msg = err.message || '';
                  if (msg.includes('FLOOD')) {
                    const waitMatch = msg.match(/FLOOD_WAIT[_\s]*(\d+)/i);
                    const waitSec = waitMatch ? parseInt(waitMatch[1]) : 5;
                    console.log(`[Monitor ${sessionId}] FLOOD_WAIT ${waitSec}s, waiting...`);
                    await new Promise(r => setTimeout(r, (waitSec + 1) * 1000));
                    continue;
                  }
                  if (msg.includes('CHAT_ADMIN_REQUIRED')) {
                    console.log(`[Monitor ${sessionId}] Not admin in "${title}", skipping GetParticipants`);
                    break;
                  }
                  break;
                }
              }
            }

            console.log(`[Monitor ${sessionId}] Cycle #${cycleCount} for "${title}": ${extractedCount} new members`);
          }

          // Wait 60 seconds before next extraction cycle
          console.log(`[Monitor ${sessionId}] Cycle #${cycleCount} complete. Waiting 60s before next cycle...`);
          for (let w = 0; w < 60; w++) {
            if (monitor.stopRequested || !activeMonitors.has(sessionId)) return;
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      };

      runContinuousExtraction().catch((e) => {
        console.error(`[Monitor ${sessionId}] Continuous extraction error for ${account.phone}: ${e.message}`);
      });
    } catch (clientErr) {
      console.error(`[Monitor ${sessionId}] Failed to connect account ${account.phone}: ${clientErr.message}`);
      monitor.errors.push(`فشل اتصال ${account.phone}: ${clientErr.message}`);
    }
  }

  if (connectedClients.length === 0) {
    return res.status(400).json({ 
      error: 'فشل اتصال جميع الحسابات',
      errors: monitor.errors 
    });
  }

  monitor.clients = connectedClients;
  // Start self-ping to prevent Railway idle timeout
  startSelfPing();
  activeMonitors.set(sessionId, monitor);

  // Start auto-add worker if target group is set
  if (monitor.targetGroup && connectedClients.length > 0) {
    const addAcc = accounts[0];
    try {
      const addClient = await getClientFromSession(addAcc.sessionString, addAcc.apiId || 123456, addAcc.apiHash || 'demo');
      startAutoAddWorker(addClient).catch((e) => {
        console.error(`[Monitor ${sessionId}] Auto-add worker crashed: ${e.message}`);
      });
    } catch (e) {
      monitor.errors.push(`فشل تشغيل الإضافة التلقائية: ${e.message}`);
    }
  }

  // Update session status
  try {
    await fetch(`${supabaseUrl}/rest/v1/monitoring_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ 
        status: 'running', 
        started_at: new Date().toISOString(),
        total_members_found: monitor.membersFound,
      }),
    });
  } catch (e) {}

  return res.json({
    success: true,
    connectedAccounts: connectedClients.length,
    totalAccounts: accounts.length,
    monitoringGroups: groups.length,
    autoAddEnabled: !!monitor.targetGroup,
    errors: monitor.errors,
    message: `تم بدء المراقبة بـ ${connectedClients.length} حساب${monitor.targetGroup ? ' مع الإضافة التلقائية' : ''}`,
  });
}

/**
 * Stop monitoring
 */
async function stopMonitor(sessionId) {
  const monitor = activeMonitors.get(sessionId);
  if (!monitor) return false;

  console.log(`[Monitor ${sessionId}] Stopping...`);
  monitor.stopRequested = true;
  
  for (const { client, phone } of monitor.clients) {
    try {
      await client.disconnect();
      console.log(`[Monitor ${sessionId}] Disconnected ${phone}`);
    } catch (e) {}
  }

  // Update session status in Supabase
  try {
    await fetch(`${monitor.supabaseUrl}/rest/v1/monitoring_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': monitor.supabaseKey,
        'Authorization': `Bearer ${monitor.supabaseKey}`,
      },
      body: JSON.stringify({ 
        status: 'stopped', 
        stopped_at: new Date().toISOString(),
        total_members_found: monitor.membersFound,
      }),
    });
  } catch (e) {}

  activeMonitors.delete(sessionId);
  return true;
}

async function handleStopMonitoring({ sessionId }, res) {
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  const stopped = await stopMonitor(sessionId);
  if (!stopped) {
    return res.status(404).json({ error: 'لا توجد جلسة مراقبة نشطة بهذا المعرف' });
  }

  return res.json({ success: true, message: 'تم إيقاف المراقبة' });
}

/**
 * Get monitoring status
 */
async function handleGetMonitoringStatus({ sessionId }, res) {
  if (sessionId) {
    const monitor = activeMonitors.get(sessionId);
    if (!monitor) {
      return res.json({ active: false, sessionId });
    }
    return res.json({
      active: true,
      sessionId,
      connectedAccounts: monitor.clients.length,
      groups: monitor.groups,
      membersFound: monitor.membersFound,
      membersAdded: monitor.membersAdded || 0,
      membersFailed: monitor.membersFailed || 0,
      addQueueSize: monitor.addQueue?.length || 0,
      autoAddEnabled: !!monitor.targetGroup,
      uptime: Math.floor((Date.now() - monitor.startedAt) / 1000),
      errors: monitor.errors,
    });
  }

  // Return all active monitors
  const monitors = [];
  for (const [id, m] of activeMonitors) {
    monitors.push({
      sessionId: id,
      connectedAccounts: m.clients.length,
      groups: m.groups,
      membersFound: m.membersFound,
      uptime: Math.floor((Date.now() - m.startedAt) / 1000),
    });
  }
  return res.json({ activeMonitors: monitors });
}

// ========== BATCH ADD SYSTEM ==========

/**
 * Start a batch-add job that runs in background
 */
async function handleStartBatchAdd({ accounts, members, targetGroup, sourceGroup, settings, jobId }, res) {
  if (!accounts || !accounts.length || !members || !members.length || !targetGroup) {
    return res.status(400).json({ error: 'Missing required: accounts, members, targetGroup' });
  }

  const id = jobId || 'batch_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

  // Stop existing job with same id
  if (activeBatchJobs.has(id)) {
    const old = activeBatchJobs.get(id);
    old.stopRequested = true;
    await new Promise(r => setTimeout(r, 500));
    activeBatchJobs.delete(id);
  }

  const job = {
    id,
    accounts,
    members: members.map(m => ({ ...m, status: 'pending', error: null })),
    targetGroup,
    sourceGroup: sourceGroup || '',
    settings: {
      delayMin: settings?.delayMin || 10,
      delayMax: settings?.delayMax || 30,
      maxRetries: settings?.maxRetries || 2,
      cooldownAfterFlood: settings?.cooldownAfterFlood || 300,
    },
    startedAt: Date.now(),
    stopRequested: false,
    pauseRequested: false,
    processed: 0,
    total: members.length,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    currentMember: null,
    currentAccount: null,
    logs: [],
    bannedAccounts: new Set(),
    notAdminAccounts: new Set(),
    accountFloodUntil: new Map(),
    currentAccountIdx: 0,
    status: 'running',
  };

  activeBatchJobs.set(id, job);
  console.log(`[BatchAdd ${id}] Starting: ${members.length} members, ${accounts.length} accounts → ${targetGroup}`);

  // Respond immediately
  res.json({ success: true, jobId: id, message: `بدأت العملية: ${members.length} عضو` });

  // Run in background
  runBatchAddJob(job).catch(err => {
    console.error(`[BatchAdd ${id}] Fatal: ${err.message}`);
    job.status = 'stopped';
    job.logs.push({ time: Date.now(), type: 'error', msg: `خطأ: ${err.message}` });
  });
}

function addJobLog(job, type, msg, phone) {
  job.logs.push({ time: Date.now(), type, msg, phone });
  if (job.logs.length > 200) job.logs = job.logs.slice(-200);
}

async function runBatchAddJob(job) {
  const { accounts, settings } = job;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const getRandomDelay = () => Math.floor(Math.random() * (settings.delayMax - settings.delayMin + 1)) + settings.delayMin;

  const getAvailableAccount = () => {
    const now = Date.now();
    for (let i = 0; i < accounts.length; i++) {
      const idx = (job.currentAccountIdx + i) % accounts.length;
      const acc = accounts[idx];
      const accKey = acc.phone || idx.toString();
      if (job.bannedAccounts.has(accKey)) continue;
      if (job.notAdminAccounts.has(accKey)) continue;
      const floodUntil = job.accountFloodUntil.get(accKey);
      if (floodUntil && now < floodUntil) continue;
      if (floodUntil && now >= floodUntil) job.accountFloodUntil.delete(accKey);
      job.currentAccountIdx = (idx + 1) % accounts.length;
      return acc;
    }
    return null;
  };

  // Pre-filter
  const hasSourceGroup = !!job.sourceGroup.trim();
  for (const m of job.members) {
    const hasUsername = !!m.username?.trim();
    const hasAccessHash = !!m.accessHash?.trim() && m.accessHash !== '0';
    if (!hasUsername && !hasAccessHash && !hasSourceGroup) {
      m.status = 'skipped';
      m.error = 'لا يوجد username أو accessHash';
      job.skippedCount++;
      job.processed++;
    }
  }

  const pendingMembers = job.members.filter(m => m.status === 'pending');
  job.total = pendingMembers.length + job.processed;
  addJobLog(job, 'info', `بدء إضافة ${pendingMembers.length} عضو بـ ${accounts.length} حساب`);

  for (let i = 0; i < pendingMembers.length; i++) {
    if (job.stopRequested) { job.status = 'stopped'; break; }
    while (job.pauseRequested && !job.stopRequested) { job.status = 'paused'; await sleep(500); }
    if (job.stopRequested) { job.status = 'stopped'; break; }
    job.status = 'running';

    const member = pendingMembers[i];
    const memberLabel = member.username ? `@${member.username}` : (member.firstName || `ID:${member.userId}`);
    job.currentMember = memberLabel;

    let retries = 0;
    let memberDone = false;

    while (!memberDone && retries <= settings.maxRetries && !job.stopRequested) {
      let account = getAvailableAccount();
      if (!account) {
        const now = Date.now();
        let shortestWait = Infinity;
        for (const [, until] of job.accountFloodUntil) { shortestWait = Math.min(shortestWait, until - now); }
        if (shortestWait < Infinity && shortestWait > 0) {
          addJobLog(job, 'info', `⏳ انتظار ${Math.ceil(shortestWait / 1000)}s`);
          await sleep(shortestWait + 1000);
          account = getAvailableAccount();
        }
        if (!account) {
          member.status = 'failed'; member.error = 'لا يوجد حسابات'; job.failedCount++;
          addJobLog(job, 'error', `لا يوجد حسابات لـ ${memberLabel}`);
          memberDone = true; break;
        }
      }

      const accKey = account.phone || job.currentAccountIdx.toString();
      job.currentAccount = account.phone;
      let client;

      try {
        client = await getClientFromSession(account.sessionString, account.apiId || 123456, account.apiHash || 'demo');
        const { type, value } = parseGroupLink(job.targetGroup);
        if (!value) { member.status = 'failed'; member.error = 'رابط غير صالح'; job.failedCount++; memberDone = true; try { await client.disconnect(); } catch(_){} break; }

        let targetEntity;
        try {
          if (type === 'hash') {
            try { const cr = await client.invoke(new Api.messages.CheckChatInvite({ hash: value })); if (cr?.chat) targetEntity = cr.chat; } catch(e) {}
            if (!targetEntity) { try { const jr = await client.invoke(new Api.messages.ImportChatInvite({ hash: value })); if (jr?.chats?.length > 0) targetEntity = jr.chats[0]; } catch(e) {} }
          } else { targetEntity = await client.getEntity(value); }
        } catch(e) {}

        if (!targetEntity) { try { await client.disconnect(); } catch(_){} retries++; addJobLog(job, 'warning', `فشل الوصول للمجموعة`, account.phone); continue; }

        const isChat = targetEntity.className === 'Chat';

        // Resolve user
        let userEntity;
        if (member.username?.trim()) {
          try { const r = await client.invoke(new Api.contacts.ResolveUsername({ username: member.username.trim().replace('@', '') })); if (r?.users?.length > 0) userEntity = r.users[0]; } catch(e) {}
        }
        if (!userEntity && job.sourceGroup && member.userId) {
          try {
            const { type: sT, value: sV } = parseGroupLink(job.sourceGroup);
            if (sV) {
              let se; if (sT === 'hash') { try { const cr = await client.invoke(new Api.messages.CheckChatInvite({ hash: sV })); if (cr?.chat) se = cr.chat; } catch(e){} } else { se = await client.getEntity(sV); }
              if (se) {
                const p = await client.invoke(new Api.channels.GetParticipants({ channel: se, filter: new Api.ChannelParticipantsSearch({ q: '' }), offset: 0, limit: 200, hash: BigInt(0) }));
                let f = p.users?.find(u => u.id?.toString() === member.userId.toString());
                if (!f && member.username) { const p2 = await client.invoke(new Api.channels.GetParticipants({ channel: se, filter: new Api.ChannelParticipantsSearch({ q: member.username.substring(0, 5) }), offset: 0, limit: 200, hash: BigInt(0) })); f = p2.users?.find(u => u.id?.toString() === member.userId.toString()); }
                if (f) userEntity = f;
              }
            }
          } catch(e) {}
        }
        if (!userEntity && member.userId && member.accessHash && member.accessHash !== '0') {
          try { userEntity = new Api.InputPeerUser({ userId: BigInt(member.userId), accessHash: BigInt(member.accessHash) }); } catch(e) {}
        }

        if (!userEntity) {
          try { await client.disconnect(); } catch(_){}
          member.status = 'skipped'; member.error = 'لا يمكن التعرف'; job.skippedCount++;
          addJobLog(job, 'info', `⏭️ ${memberLabel}: لا يمكن التعرف`, account.phone);
          memberDone = true; break;
        }

        let inputUser;
        if (userEntity.className === 'User') { inputUser = new Api.InputUser({ userId: userEntity.id, accessHash: userEntity.accessHash || BigInt(0) }); }
        else if (userEntity.className === 'InputPeerUser') { inputUser = new Api.InputUser({ userId: userEntity.userId, accessHash: userEntity.accessHash || BigInt(0) }); }
        else { inputUser = userEntity; }

        // Add with flood retry
        let addOk = false;
        for (let att = 0; att <= 3; att++) {
          try {
            if (isChat) { await client.invoke(new Api.messages.AddChatUser({ chatId: targetEntity.id, userId: inputUser, fwdLimit: 100 })); }
            else { await client.invoke(new Api.channels.InviteToChannel({ channel: targetEntity, users: [inputUser] })); }
            addOk = true; break;
          } catch (err) {
            const em = err.message || '';
            if (em.includes('FLOOD_WAIT')) { const ws = parseInt((em.match(/(\d+)/)||['60'])[0]); if (att < 3) { addJobLog(job, 'warning', `FLOOD ${ws}s`, account.phone); await sleep((ws+1)*1000); continue; } else { job.accountFloodUntil.set(accKey, Date.now()+ws*1000); retries++; break; } }
            if (em.includes('PEER_FLOOD')) { if (att < 3) { await sleep(30000*(att+1)); continue; } job.accountFloodUntil.set(accKey, Date.now()+60000); retries++; break; }
            if (em.includes('USER_ALREADY_PARTICIPANT')) { member.status='skipped'; member.error='موجود مسبقاً'; job.skippedCount++; addJobLog(job,'info',`⏭️ ${memberLabel} موجود`); memberDone=true; break; }
            if (em.includes('CHAT_ADMIN_REQUIRED')||em.includes('CHAT_WRITE_FORBIDDEN')) { job.notAdminAccounts.add(accKey); addJobLog(job,'error',`${account.phone} ليس مشرفاً`); retries++; break; }
            if (em.includes('USER_PRIVACY')||em.includes('USER_NOT_MUTUAL')||em.includes('DEACTIVATED')||em.includes('USER_CHANNELS_TOO')||em.includes('USER_BANNED')||em.includes('USER_KICKED')||em.includes('USER_ID_INVALID')) {
              member.status='skipped'; member.error=em.substring(0,40); job.skippedCount++; addJobLog(job,'info',`⏭️ ${memberLabel}: ${em.substring(0,40)}`); memberDone=true; break;
            }
            member.status='failed'; member.error=em.substring(0,50); job.failedCount++; addJobLog(job,'error',`❌ ${memberLabel}: ${em.substring(0,50)}`); memberDone=true; break;
          }
        }
        if (addOk) { member.status='added'; job.successCount++; addJobLog(job,'success',`✅ ${memberLabel}`,account.phone); memberDone=true; }
        try { await client.disconnect(); } catch(_){}

      } catch (outerErr) {
        if (client) { try { await client.disconnect(); } catch(_){} }
        addJobLog(job, 'error', `خطأ: ${(outerErr.message||'').substring(0,50)}`, account.phone);
        retries++;
      }
    }

    if (!memberDone && !job.stopRequested) { member.status='failed'; member.error='استنفذت المحاولات'; job.failedCount++; }
    job.processed++;

    if (!job.stopRequested && i < pendingMembers.length - 1) {
      const delay = getRandomDelay();
      for (let d = 0; d < delay; d++) {
        if (job.stopRequested) break;
        while (job.pauseRequested && !job.stopRequested) await sleep(500);
        await sleep(1000);
      }
    }
  }

  if (!job.stopRequested) job.status = 'completed';
  job.currentMember = null; job.currentAccount = null;
  addJobLog(job, 'success', `انتهت: ${job.successCount} نجاح، ${job.failedCount} فشل، ${job.skippedCount} تخطي`);
  console.log(`[BatchAdd ${job.id}] Done: ${job.successCount}/${job.failedCount}/${job.skippedCount}`);
  setTimeout(() => { activeBatchJobs.delete(job.id); }, 3600000);
}

async function handleStopBatchAdd({ jobId }, res) {
  const job = activeBatchJobs.get(jobId);
  if (!job) return res.json({ success: false, error: 'لا توجد عملية' });
  job.stopRequested = true; job.pauseRequested = false; job.status = 'stopped';
  return res.json({ success: true });
}

async function handlePauseBatchAdd({ jobId, pause }, res) {
  const job = activeBatchJobs.get(jobId);
  if (!job) return res.json({ success: false, error: 'لا توجد عملية' });
  job.pauseRequested = !!pause;
  if (!pause) job.status = 'running';
  return res.json({ success: true, paused: !!pause });
}

async function handleGetBatchAddStatus({ jobId }, res) {
  if (jobId) {
    const job = activeBatchJobs.get(jobId);
    if (!job) return res.json({ active: false, jobId });
    return res.json({
      active: job.status === 'running' || job.status === 'paused',
      jobId: job.id, status: job.status,
      processed: job.processed, total: job.total,
      successCount: job.successCount, failedCount: job.failedCount, skippedCount: job.skippedCount,
      currentMember: job.currentMember, currentAccount: job.currentAccount,
      uptime: Math.floor((Date.now() - job.startedAt) / 1000),
      logs: job.logs.slice(-50),
      members: job.members.map(m => ({ userId: m.userId, username: m.username, status: m.status, error: m.error })),
    });
  }
  const jobs = [];
  for (const [id, j] of activeBatchJobs) { jobs.push({ jobId: id, status: j.status, processed: j.processed, total: j.total, successCount: j.successCount }); }
  return res.json({ jobs });
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
