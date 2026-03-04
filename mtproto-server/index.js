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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Telegram MTProto Server is running',
    version: '2.1.0',
    activeMonitors: activeMonitors.size,
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
      case 'startMonitoring':
        return await handleStartMonitoring(params, res);
      case 'stopMonitoring':
        return await handleStopMonitoring(params, res);
      case 'getMonitoringStatus':
        return await handleGetMonitoringStatus(params, res);
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
    if (isChat) {
      console.log(`[ADD] Using AddChatUser (basic group)`);
      result = await client.invoke(
        new Api.messages.AddChatUser({
          chatId: targetEntity.id,
          userId: inputUser,
          fwdLimit: 100,
        })
      );
    } else {
      console.log(`[ADD] Using InviteToChannel (supergroup/channel)`);
      result = await client.invoke(
        new Api.channels.InviteToChannel({
          channel: targetEntity,
          users: [inputUser],
        })
      );
    }
    
    // ===== STEP 4: Check result =====
    // Check missingInvitees (Telegram's explicit rejection)
    if (result?.missingInvitees && result.missingInvitees.length > 0) {
      const missing = result.missingInvitees[0];
      await client.disconnect();
      if (missing.premiumWouldAllowInvite) {
        return res.json({ success: false, error: 'يتطلب حساب بريميوم للإضافة', premiumRequired: true });
      }
      return res.json({ success: false, error: 'رفض صامت - تيليجرام لم يقبل الإضافة', silentRejection: true });
    }
    
    // If no error was thrown and no missingInvitees, treat as success
    // Wait briefly so backend only reports success after Telegram request is fully settled
    await new Promise((r) => setTimeout(r, 1500));
    await client.disconnect();
    console.log(`[ADD] ✅ Success: ${username || userId} → ${targetEntity.title}`);
    return res.json({ success: true, message: `تمت إضافة ${username || userId}` });
    
  } catch (error) {
    if (client) { try { await client.disconnect(); } catch (_) {} }
    
    const errorMessage = error.message || '';
    console.error(`[ADD] Error: ${errorMessage}`);
    
    // Map errors to user-friendly responses
    if (errorMessage.includes('USER_PRIVACY_RESTRICTED'))
      return res.json({ success: false, error: 'خصوصية المستخدم تمنع الإضافة' });
    if (errorMessage.includes('USER_NOT_MUTUAL_CONTACT'))
      return res.json({ success: false, error: 'يجب أن يكون جهة اتصال متبادلة' });
    if (errorMessage.includes('USER_ALREADY_PARTICIPANT'))
      return res.json({ success: false, alreadyParticipant: true, error: 'العضو موجود مسبقاً' });
    if (errorMessage.includes('PEER_FLOOD') || errorMessage.includes('FLOOD_WAIT')) {
      const waitMatch = errorMessage.match(/FLOOD_WAIT[_\s]*(\d+)/i);
      const waitSec = waitMatch ? parseInt(waitMatch[1]) : 60;
      return res.json({ success: false, error: `تم تجاوز الحد - انتظر ${waitSec} ثانية`, floodWait: waitSec });
    }
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
        try {
          const jr = await addClient.invoke(new Api.messages.ImportChatInvite({ hash: tValue }));
          if (jr?.chats?.length > 0) targetEntity = jr.chats[0];
        } catch (e) { if (!e.message?.includes('USER_ALREADY_PARTICIPANT')) throw e; }
        if (!targetEntity) {
          const cr = await addClient.invoke(new Api.messages.CheckChatInvite({ hash: tValue }));
          targetEntity = cr?.chat || null;
        }
      } else {
        try { await addClient.invoke(new Api.channels.JoinChannel({ channel: tValue })); } catch (e) {}
        targetEntity = await addClient.getEntity(tValue);
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
            try {
              const joinResult = await client.invoke(new Api.messages.ImportChatInvite({ hash: value }));
              if (joinResult?.chats?.length > 0) entity = joinResult.chats[0];
            } catch (e) {
              if (!e.message?.includes('USER_ALREADY_PARTICIPANT')) throw e;
            }
            // If already participant, resolve via CheckChatInvite
            if (!entity) {
              try {
                const checkResult = await client.invoke(new Api.messages.CheckChatInvite({ hash: value }));
                entity = checkResult?.chat || null;
              } catch (e) {}
            }
          } else {
            try {
              await client.invoke(new Api.channels.JoinChannel({ channel: value }));
            } catch (e) {
              if (!e.message?.includes('USER_ALREADY_PARTICIPANT')) throw e;
            }
            try {
              entity = await client.getEntity(value);
            } catch (e) {}
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
