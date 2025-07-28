import 'dotenv/config';
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Debug environment variables
console.log('[Env] DISCORD_TOKEN exists:', !!process.env.DISCORD_TOKEN);
console.log('[Env] STARTUP_CHANNEL_ID:', process.env.STARTUP_CHANNEL_ID);
console.log('[Env] DISCORD_CHANNEL_ID:', process.env.DISCORD_CHANNEL_ID);

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences // メンバー情報の取得に必要な場合
  ]
});

// Debug - list all events
client.on('debug', (info) => {
  if (info.includes('messageCreate') || info.includes('Heartbeat')) {
    // Skip noisy debug messages
    return;
  }
  console.log('[Discord Debug]', info);
});

// Event emitter for approval flow
const approvalEmitter = new EventEmitter();

// Map to track pending approvals
const pendingApprovals = new Map();

// Express app setup for HTTP endpoints
const app = express();
app.use(express.json());

// Find available port
let httpPort = 3000;
const server = createServer(app);

// Approval request endpoint (for MCP server)
app.post('/approval_request', async (req, res) => {
  console.log('[HTTP] /approval_request endpoint called');
  console.log('[HTTP] Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { tool_name, input, requestId } = req.body;
    console.log('[HTTP] Received approval request:', { tool_name, requestId });
    
    // 承認リクエストをイベントとして発行
    const approvalData = {
      requestId: requestId || `req_${Date.now()}`,
      tool_name,
      input,
      timestamp: new Date().toISOString()
    };
    
    console.log('[HTTP] Emitting approval_request event with data:', approvalData);
    approvalEmitter.emit('approval_request', approvalData);
    
    // 承認結果を待つ（最大30秒）
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Approval timeout'));
      }, 30000);
      
      approvalEmitter.once(`approval_result_${approvalData.requestId}`, (result) => {
        console.log('[HTTP] Received approval result:', result);
        clearTimeout(timeout);
        resolve(result);
      });
    });
    
    console.log('[HTTP] Sending response back to MCP server:', { success: true, result });
    res.json({ success: true, result });
  } catch (error) {
    console.error('[HTTP] Approval request error:', error);
    res.json({ 
      success: false, 
      result: {
        behavior: "deny",
        message: error.message === 'Approval timeout' 
          ? "承認タイムアウト：30秒以内に応答がありませんでした"
          : `エラー: ${error.message}`
      }
    });
  }
});

// Image sending endpoint
app.post('/send_image', async (req, res) => {
  console.log('=== /send_image endpoint called ===');
  console.log('Request body:', req.body);
  
  const { channel_id, file_path } = req.body;
  
  if (!channel_id || !file_path) {
    console.error('Missing required parameters');
    return res.status(400).json({ 
      success: false, 
      error: 'channel_id and file_path are required' 
    });
  }
  
  try {
    const channel = client.channels.cache.get(channel_id);
    if (!channel) {
      console.error('Channel not found:', channel_id);
      return res.status(404).json({ 
        success: false, 
        error: 'Channel not found' 
      });
    }
    
    const fileExists = await fs.access(file_path).then(() => true).catch(() => false);
    if (!fileExists) {
      console.error('File not found:', file_path);
      return res.status(404).json({ 
        success: false, 
        error: 'File not found' 
      });
    }
    
    await channel.send({
      files: [file_path]
    });
    
    console.log('Image sent successfully!');
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending image:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Bot ready event
// Test raw event
client.on('raw', (packet) => {
  if (packet.t === 'MESSAGE_CREATE') {
    console.log('[Discord RAW] MESSAGE_CREATE event detected');
  }
});

client.on('ready', () => {
  console.log(`[Discord] Logged in as ${client.user.tag}!`);
  console.log(`[Discord] Bot user ID: ${client.user.id}`);
  console.log(`[Discord] Bot username: ${client.user.username}`);
  
  const guilds = client.guilds.cache;
  console.log(`[Discord] Bot is in ${guilds.size} servers`);
  guilds.forEach(guild => {
    console.log(`[Discord] - ${guild.name} (ID: ${guild.id})`);
    
    // List channels in the guild
    const textChannels = guild.channels.cache.filter(ch => ch.type === 0);
    console.log(`[Discord]   Text channels in ${guild.name}:`);
    textChannels.forEach(ch => {
      console.log(`[Discord]   - #${ch.name} (ID: ${ch.id})`);
    });
  });
  
  // Send startup message
  if (process.env.STARTUP_CHANNEL_ID) {
    const channel = client.channels.cache.get(process.env.STARTUP_CHANNEL_ID);
    console.log(`Trying to send to channel: ${process.env.STARTUP_CHANNEL_ID}`);
    if (channel) {
      console.log(`Channel found: ${channel.name}`);
      channel.send('✅ Bot起動しました！メンションして話しかけてください。')
        .then(async () => {
          console.log('Startup message sent!');
          
          // テスト用ボタンメッセージを送信
          try {
            const testEmbed = new EmbedBuilder()
              .setColor(0x00FF00)
              .setTitle('🔘 ボタンテスト')
              .setDescription('Discordボタン機能のテストです');
            
            const testButton = new ButtonBuilder()
              .setCustomId('test_button')
              .setLabel('Yes')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('👍');
            
            const row = new ActionRowBuilder()
              .addComponents(testButton);
            
            await channel.send({
              embeds: [testEmbed],
              components: [row]
            });
            
            console.log('Test button message sent!');
          } catch (error) {
            console.error('Error sending test button:', error);
          }
        })
        .catch(err => console.error('Failed to send startup message:', err));
    } else {
      console.log('Channel not found! Available channels:');
      client.channels.cache.forEach(ch => {
        if (ch.type === 0) { // Text channel
          console.log(`  - ${ch.name} (ID: ${ch.id}) in ${ch.guild.name}`);
        }
      });
    }
  } else {
    console.log('STARTUP_CHANNEL_ID not set in environment variables');
  }
});

// Message handling
client.on('messageCreate', async message => {
  console.log(`[Discord] Message received from ${message.author.tag}: ${message.content}`);
  
  // Ignore bot messages
  if (message.author.bot) {
    console.log('[Discord] Ignoring bot message');
    return;
  }
  
  // Check channel member count
  let humanMemberCount = 0;
  let totalMemberCount = 0;
  try {
    if (message.channel.type === 0 && message.guild) { // Guild text channel
      // チャンネルの権限を見て、アクセスできるメンバーを取得
      const guild = message.guild;
      const channel = message.channel;
      
      // ギルドの全メンバーを取得
      const allMembers = await guild.members.fetch();
      
      // このチャンネルを見ることができるメンバーをフィルタ
      const channelMembers = allMembers.filter(member => 
        channel.permissionsFor(member).has('ViewChannel')
      );
      
      humanMemberCount = channelMembers.filter(member => !member.user.bot).size;
      totalMemberCount = channelMembers.size;
      console.log(`[Discord] Channel members - Total: ${totalMemberCount}, Humans: ${humanMemberCount}`);
    }
  } catch (error) {
    console.error('[Discord] Error fetching channel members:', error);
    // エラーの場合はメンション必須にする
    humanMemberCount = 999;
  }
  
  console.log('[Discord] Checking for bot mention...');
  console.log('[Discord] Bot ID:', client.user.id);
  console.log('[Discord] Mentions:', Array.from(message.mentions.users.keys()));
  
  // Check if bot is mentioned or if channel has only 2 members
  const isMentioned = message.mentions.has(client.user);
  const isTestCommand = message.content.toLowerCase().startsWith('!test');
  const isPrivateChannel = humanMemberCount === 1 && totalMemberCount === 2; // ボット1人と人間1人のプライベートチャンネル
  
  console.log(`[Discord] Is mentioned: ${isMentioned}, Is test command: ${isTestCommand}, Is private channel (1 human + 1 bot): ${isPrivateChannel}`);
  
  if (isMentioned || isTestCommand || isPrivateChannel) {
    console.log(`[Discord] Processing message from ${message.author.tag}: ${message.content}`);
    
    // Extract the actual prompt by removing the mention
    const prompt = message.content.replace(/<@!?\d+>/g, '').trim();
    
    if (!prompt) {
      await message.reply('何か質問や依頼を入力してください！');
      return;
    }
    
    // Initial response
    const initialReply = await message.reply('リクエストを処理中です... 🔄');
    
    console.log('[Main] Starting Claude Code subprocess...');
    
    try {
      const result = await callClaudeCodeSubprocess(prompt, message, initialReply);
      
      console.log('[Main] Result:', result);
      
      if (result.error) {
        await initialReply.edit(`エラーが発生しました: ${result.error}`);
        return;
      }
      
      // Final message
      await message.channel.send('以上でおわりです');
    } catch (error) {
      console.error('[Main] Error details:', error);
      console.error('[Main] Error stack:', error.stack);
      
      let errorMessage = 'エラーが発生しました';
      if (error.message.includes('Credit balance is too low')) {
        errorMessage = 'クレジットがたりません';
      } else {
        errorMessage += `: ${error.message}`;
      }
      
      await initialReply.edit(errorMessage);
    }
  }
});

// Claude Code subprocess implementation
const callClaudeCodeSubprocess = async (prompt, discordMessage, initialReply) => {
  console.log('[Subprocess] callClaudeCodeSubprocess called with prompt:', prompt);
  
  // Create MCP config file
  const mcpConfig = {
    mcpServers: {
      "ccd-permissions": {
        command: "node",
        args: [path.join(__dirname, "mcp-server.js")],
        type: "stdio"
      }
    }
  };
  
  const configPath = path.join(__dirname, 'temp-mcp-config.json');
  console.log('[Subprocess] Writing MCP config to:', configPath);
  await fs.writeFile(configPath, JSON.stringify(mcpConfig, null, 2));
  
  try {
    // Prepare enhanced prompt
    const enhancedPrompt = `現在時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
コンテキスト: Discordボットからのリモート操作
作業ディレクトリ: ${process.cwd()}

ユーザーのリクエスト: ${prompt}`;
    
    console.log('[Subprocess] Enhanced prompt prepared');
    console.log('[Subprocess] Starting Claude Code process...');
    
    // Start Claude Code process
    const claudeArgs = [
      '--mcp-config', configPath,
      '--permission-prompt-tool', 'mcp__ccd-permissions__approval_prompt',
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose'
    ];
    
    console.log('[Subprocess] Claude command: claude', claudeArgs.join(' '));
    
    const claudeProcess = spawn('claude', claudeArgs, {
      cwd: process.cwd(),
      env: { ...process.env }
    });
    
    console.log('[Subprocess] Claude process spawned with PID:', claudeProcess.pid);
    
    // Track session state
    let sessionId = null;
    let messages = [];
    let lastStreamedMessage = null;
    
    // Setup stdout reader
    const stdoutReader = readline.createInterface({
      input: claudeProcess.stdout,
      crlfDelay: Infinity
    });
    
    // Setup stderr reader
    const stderrReader = readline.createInterface({
      input: claudeProcess.stderr,
      crlfDelay: Infinity
    });
    
    // Handle stdout (JSON Lines)
    stdoutReader.on('line', async (line) => {
      console.log('[Subprocess stdout]:', line);
      try {
        const message = JSON.parse(line);
        console.log('[Subprocess] Received message type:', message.type);
        messages.push(message);
        
        // Handle different message types
        switch (message.type) {
          case 'system':
            if (message.subtype === 'init') {
              sessionId = message.session_id;
              console.log('Session initialized:', sessionId);
            }
            break;
            
          case 'assistant':
            // Stream assistant messages to Discord
            if (message.message && message.message.content) {
              const textContent = message.message.content
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join('\n')
                .trim();
              
              if (textContent) {
                if (!lastStreamedMessage) {
                  // First streaming message
                  lastStreamedMessage = await discordMessage.channel.send(textContent);
                  console.log('Sent initial streaming message to Discord');
                } else if (textContent.length <= 2000) {
                  // Update existing message
                  await lastStreamedMessage.edit(textContent);
                  console.log('Updated streaming message in Discord');
                } else {
                  // Content too long, send new message
                  lastStreamedMessage = await discordMessage.channel.send(textContent.slice(0, 2000));
                  console.log('Sent continuation streaming message to Discord');
                }
              }
            }
            break;
            
          case 'result':
            console.log('Received result:', message);
            if (message.result) {
              // Edit initial reply with result
              await initialReply.edit(message.result.slice(0, 2000));
            }
            // Result messageを受け取ったらプロセスを正常終了
            claudeProcess.stdin.end();
            break;
        }
      } catch (error) {
        console.error('Error parsing JSON line:', error);
        console.error('Line content:', line);
      }
    });
    
    // Handle stderr
    stderrReader.on('line', (line) => {
      console.error('[Subprocess stderr]:', line);
    });
    
    // Send initial prompt
    const initialMessage = {
      type: "user",
      message: {
        role: "user",
        content: enhancedPrompt
      }
    };
    
    console.log('[Subprocess] Sending initial message:', JSON.stringify(initialMessage));
    claudeProcess.stdin.write(JSON.stringify(initialMessage) + '\n');
    console.log('[Subprocess] Initial message sent');
    
    // Wait for process completion
    return new Promise((resolve, reject) => {
      let timeoutId;
      
      // Add timeout
      timeoutId = setTimeout(() => {
        console.error('[Subprocess] Process timeout after 60 seconds');
        claudeProcess.kill();
        reject(new Error('Process timeout'));
      }, 60000);
      
      claudeProcess.on('exit', async (code, signal) => {
        console.log(`[Subprocess] Claude process exited with code ${code} and signal ${signal}`);
        
        // Clear timeout
        clearTimeout(timeoutId);
        
        // Cleanup config file
        await fs.unlink(configPath).catch((err) => {
          console.error('[Subprocess] Failed to cleanup config file:', err);
        });
        
        if (code === 0 || code === null) { // null is normal for stdin.end()
          console.log('[Subprocess] Process completed successfully');
          resolve({ success: true, messages });
        } else {
          console.error('[Subprocess] Process failed with code:', code);
          reject(new Error(`Process exited with code ${code}`));
        }
      });
      
      claudeProcess.on('error', (error) => {
        console.error('[Subprocess] Process error:', error);
        clearTimeout(timeoutId);
        reject(error);
      });
    });
    
  } catch (error) {
    console.error('[Subprocess] Error in callClaudeCodeSubprocess:', error);
    // Cleanup config file on error
    await fs.unlink(configPath).catch(() => {});
    throw error;
  }
};

// Approval request handler
approvalEmitter.on('approval_request', async (request) => {
  console.log('[Discord] Approval request received:', request);
  
  try {
    // Get the channel to send approval request
    const channelId = process.env.STARTUP_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID;
    const channel = client.channels.cache.get(channelId);
    
    if (!channel) {
      console.error('[Discord] Channel not found for approval request');
      approvalEmitter.emit(`approval_result_${request.requestId}`, {
        behavior: "deny",
        message: "承認チャンネルが見つかりません"
      });
      return;
    }
    
    // Create embed
    const embed = new EmbedBuilder()
      .setColor(0xFFFF00)
      .setTitle('🔐 ツール実行の承認リクエスト')
      .setDescription(`Claude Codeが以下のツールの実行許可を求めています`)
      .addFields(
        { name: 'ツール名', value: `\`${request.tool_name}\``, inline: true },
        { name: 'リクエストID', value: `\`${request.requestId}\``, inline: true },
        { name: 'タイムスタンプ', value: new Date(request.timestamp).toLocaleString('ja-JP'), inline: false },
        { name: 'パラメータ', value: `\`\`\`json\n${JSON.stringify(request.input, null, 2)}\`\`\`` }
      )
      .setFooter({ text: '30秒以内に応答してください' });
    
    // Create buttons
    console.log('[Discord] Creating buttons with requestId:', request.requestId);
    const allowButton = new ButtonBuilder()
      .setCustomId(`approve_${request.requestId}`)
      .setLabel('許可')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');
    
    const denyButton = new ButtonBuilder()
      .setCustomId(`deny_${request.requestId}`)
      .setLabel('拒否')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌');
    
    console.log('[Discord] Button customIds:', {
      allow: `approve_${request.requestId}`,
      deny: `deny_${request.requestId}`
    });
    
    const row = new ActionRowBuilder()
      .addComponents(allowButton, denyButton);
    
    // Send message
    const approvalMessage = await channel.send({
      embeds: [embed],
      components: [row]
    });
    
    // Store request info
    console.log('[Discord] Storing pending approval with requestId:', request.requestId);
    pendingApprovals.set(request.requestId, {
      request,
      message: approvalMessage,
      timeout: setTimeout(() => {
        handleApprovalTimeout(request.requestId);
      }, 30000)
    });
    console.log('[Discord] Current pending approvals:', Array.from(pendingApprovals.keys()));
    
  } catch (error) {
    console.error('[Discord] Error sending approval request:', error);
    approvalEmitter.emit(`approval_result_${request.requestId}`, {
      behavior: "deny",
      message: `エラー: ${error.message}`
    });
  }
});

// Handle approval timeout
async function handleApprovalTimeout(requestId) {
  const pending = pendingApprovals.get(requestId);
  if (!pending) return;
  
  try {
    // Disable buttons
    const disabledRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_${requestId}`)
          .setLabel('許可')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅')
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`deny_${requestId}`)
          .setLabel('拒否')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌')
          .setDisabled(true)
      );
    
    await pending.message.edit({
      embeds: [
        EmbedBuilder.from(pending.message.embeds[0])
          .setColor(0x808080)
          .setFooter({ text: 'タイムアウト：応答期限を過ぎました' })
      ],
      components: [disabledRow]
    });
  } catch (error) {
    console.error('[Discord] Error updating timeout message:', error);
  }
  
  pendingApprovals.delete(requestId);
}

// Button interaction handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  // Test button handler
  if (interaction.customId === 'test_button') {
    await interaction.reply({
      content: 'Yesボタンがクリックされました！',
      ephemeral: true
    });
    console.log('Test button clicked by:', interaction.user.tag);
    return;
  }
  
  // customIdを最初の'_'でのみ分割
  const firstUnderscoreIndex = interaction.customId.indexOf('_');
  const action = interaction.customId.substring(0, firstUnderscoreIndex);
  const requestId = interaction.customId.substring(firstUnderscoreIndex + 1);
  
  console.log('[Discord] Button clicked:', { action, requestId, customId: interaction.customId });
  console.log('[Discord] Current pending approvals:', Array.from(pendingApprovals.keys()));
  
  if (action !== 'approve' && action !== 'deny') return;
  
  const pending = pendingApprovals.get(requestId);
  console.log('[Discord] Found pending approval:', !!pending);
  
  if (!pending) {
    console.log('[Discord] No pending approval found for requestId:', requestId);
    await interaction.reply({
      content: 'このリクエストは既に処理されているか、タイムアウトしました。',
      ephemeral: true
    });
    return;
  }
  
  // Clear timeout
  clearTimeout(pending.timeout);
  
  // Send result
  const result = action === 'approve' 
    ? { behavior: "allow", updatedInput: pending.request.input }
    : { behavior: "deny", message: `${interaction.user.tag}によって拒否されました` };
  
  approvalEmitter.emit(`approval_result_${requestId}`, result);
  
  // Update message
  try {
    const resultEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(action === 'approve' ? 0x00FF00 : 0xFF0000)
      .setFooter({ 
        text: `${action === 'approve' ? '許可' : '拒否'}されました by ${interaction.user.tag}` 
      });
    
    const disabledRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_${requestId}`)
          .setLabel('許可')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅')
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`deny_${requestId}`)
          .setLabel('拒否')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌')
          .setDisabled(true)
      );
    
    await interaction.update({
      embeds: [resultEmbed],
      components: [disabledRow]
    });
  } catch (error) {
    console.error('[Discord] Error updating approval message:', error);
  }
  
  pendingApprovals.delete(requestId);
});

// HTTP Server startup
const startHttpServer = () => {
  server.listen(httpPort)
    .on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${httpPort} is busy, trying ${httpPort + 1}...`);
        httpPort++;
        setTimeout(startHttpServer, 100);
      } else {
        console.error('HTTP server error:', err);
      }
    })
    .on('listening', () => {
      console.log(`\n🌐 HTTP server started on port ${httpPort}`);
      console.log(`   Image upload endpoint: http://localhost:${httpPort}/send_image`);
      console.log(`   Approval request endpoint: http://localhost:${httpPort}/approval_request`);
      console.log(`   Use curl to send images:`);
      console.log(`   curl -X POST http://localhost:${httpPort}/send_image \\`);
      console.log(`        -H "Content-Type: application/json" \\`);
      console.log(`        -d '{"channel_id": "CHANNEL_ID", "file_path": "/path/to/image.png"}'`);
      console.log('');
    });
};

// Start servers
startHttpServer();
client.login(process.env.DISCORD_TOKEN);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});