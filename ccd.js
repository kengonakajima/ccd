import { Client, GatewayIntentBits } from 'discord.js';
import { query } from '@anthropic-ai/claude-code';
import express from 'express';
import { createServer } from 'http';
import dotenv from 'dotenv';

dotenv.config();

// Express app setup
const app = express();
app.use(express.json());

// Find available port
let httpPort = 3000;
const server = createServer(app);

// Image sending endpoint
app.post('/send_image', async (req, res) => {
  console.log('=== /send_image endpoint called ===');
  console.log('Request body:', req.body);
  
  const { channel_id, file_path } = req.body;
  
  if (!channel_id || !file_path) {
    return res.status(400).json({ 
      error: 'Missing required parameters: channel_id and file_path' 
    });
  }
  
  try {
    // Get channel from Discord client
    const channel = client.channels.cache.get(channel_id);
    
    if (!channel) {
      console.error(`Channel not found: ${channel_id}`);
      return res.status(404).json({ 
        error: `Channel not found: ${channel_id}` 
      });
    }
    
    // Send image using existing sendImageToChannel function
    const { AttachmentBuilder } = await import('discord.js');
    const fs = await import('fs');
    
    if (!fs.existsSync(file_path)) {
      console.error(`File not found: ${file_path}`);
      return res.status(404).json({ 
        error: `File not found: ${file_path}` 
      });
    }
    
    const fileName = file_path.split('/').pop();
    const attachment = new AttachmentBuilder(file_path, { name: fileName });
    
    await channel.send({ files: [attachment] });
    console.log(`Image sent successfully: ${file_path} to channel ${channel_id}`);
    
    res.json({ 
      success: true, 
      message: `Image sent to channel ${channel_id}`,
      file: fileName 
    });
    
  } catch (error) {
    console.error('Error sending image:', error);
    res.status(500).json({ 
      error: 'Failed to send image', 
      details: error.message 
    });
  }
});

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is in ${client.guilds.cache.size} servers`);
  
  // 参加しているサーバーの一覧を表示
  client.guilds.cache.forEach(guild => {
    console.log(`- ${guild.name} (ID: ${guild.id})`);
  });
  
  client.user.setPresence({
    activities: [{ name: 'メンションを待機中' }],
    status: 'online',
  });
  
  // 起動メッセージを送信（チャンネルIDを環境変数から取得）
  if (process.env.STARTUP_CHANNEL_ID) {
    const channel = client.channels.cache.get(process.env.STARTUP_CHANNEL_ID);
    console.log(`Trying to send to channel: ${process.env.STARTUP_CHANNEL_ID}`);
    if (channel) {
      console.log(`Channel found: ${channel.name}`);
      channel.send('✅ Bot起動しました！メンションして話しかけてください。')
        .then(() => console.log('Startup message sent!'))
        .catch(err => console.error('Failed to send startup message:', err));
    } else {
      console.log('Channel not found! Available channels:');
      client.channels.cache.forEach(ch => {
        if (ch.type === 0) { // Text channel
          console.log(`- ${ch.name} (ID: ${ch.id})`);
        }
      });
    }
  }
});

async function queryClaudeCode(prompt, httpServerPort, discordChannel) {
  const messages = [];
  let lastSentMessageId = null;
  
  // プロンプトにHTTPサーバー情報を追加
  const enhancedPrompt = `
あなたはリモート(Discord上)にいるユーザーから指示されて仕事をするエージェントです。
ユーザーはリモートにいるので、ローカルPCの操作ができません。たとえば、画面を見るとか、音を聞くなど。
したがって、あなたはリモートにいるユーザーに変わって、ローカルPCを操作しなければなりません。
CLIツールなら出力の文字列を、Webアプリならplaywrightを駆使して画面写真を撮影します。
また、ネイティブアプリの場合は、開発中のネイティブアプリの場合は、
自分自身の描画結果をキャプチャするような機能を実装している場合は、その機能を使って画面写真を送信できます。

リモートからの指示はできるだけ早く応答したいので、ずっと時間がかかりうること、
たとえばサーバーをバックグランドで起動してずっと待つようなことはしないで、
かならず10~30秒程度のtimeoutを設定して実行するようにしてください。
listenするようなプログラムを、時間制限がない状態で起動しないようにして下さい。


画像送信用のHTTPサーバーが http://localhost:${httpServerPort} で起動しています。

画像をDiscordに送信する方法:
1. 既存の画像ファイルを送信:
   curl -X POST http://localhost:${httpServerPort}/send_image \
        -H "Content-Type: application/json" \
        -d '{"channel_id": "${process.env.STARTUP_CHANNEL_ID}", "file_path": "/path/to/image.png"}'

2. スクリーンショットを撮影して送信する場合: webアプリの場合は、playwrightを使って画面写真をとる。
ネイティブアプリの場合は、画面がロックされていると撮影できないので、ロックされてるかどうか調べて、
ロックされているときは無理とユーザーに伝える。

   # Step 1: スクリーンショットを撮影（macOS）
   screencapture -x /tmp/screenshot.png
   
   # Step 2: 撮影した画像を送信
   curl -X POST http://localhost:${httpServerPort}/send_image \
        -H "Content-Type: application/json" \
        -d '{"channel_id": "${process.env.STARTUP_CHANNEL_ID}", "file_path": "/tmp/screenshot.png"}'




ユーザーのリクエスト: ${prompt}`;
  
  console.log('Querying Claude Code with enhanced prompt');
  
  for await (const message of query({
    prompt: enhancedPrompt,
    abortController: new AbortController(),
    options: {
      maxTurns: 20, // for longer tasks, enable development
      "continue": true,
      verbose: true,
      model: "claude-sonnet-4-20250514",      
      allowedTools: ["Read", "Write", "Edit", "Create","Bash"], // for dev
      permissionMode: "acceptEdits" // for dev
    },
  })) {
    console.log('Received message type:', message.type);
    messages.push(message);
    
    // Assistantのテキストメッセージを即時送信
    if (message.type === 'assistant' && message.message && message.message.content) {
      const textContent = message.message.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n')
        .trim();
      
      if (textContent && discordChannel) {
        try {
          // 初回メッセージか、続きのメッセージかを判断
          if (!lastSentMessageId) {
            // 初回メッセージを送信
            const sentMessage = await discordChannel.send({
              content: textContent.length > 2000 ? textContent.substring(0, 1997) + '...' : textContent,
              tts: true
            });
            lastSentMessageId = sentMessage.id;
            console.log('Sent initial streaming message to Discord');
          } else {
            // 続きのメッセージを送信
            await discordChannel.send({
              content: textContent.length > 2000 ? textContent.substring(0, 1997) + '...' : textContent,
              tts: true
            });
            console.log('Sent continuation streaming message to Discord');
          }
        } catch (error) {
          console.error('Error sending streaming message to Discord:', error);
        }
      }
    }
  }
  
  console.log('All messages:', messages);
  
  // Extract the assistant's response text from the result message
  const resultMessage = messages.find(msg => msg.type === 'result' && msg.subtype === 'success');
  if (resultMessage && resultMessage.result) {
    console.log('Found result:', resultMessage.result);
    
    // Check for credit balance error
    if (resultMessage.is_error && resultMessage.result === 'Credit balance is too low') {
      console.log('Credit balance error detected');
      return { text: 'クレジットが足りません。Claude Codeのクレジットを追加してください。', streamed: false };
    }
    
    // 最終結果があるが、すでにストリーミングで送信済みの場合はnullを返す
    return { text: null, streamed: lastSentMessageId !== null };
  }
  
  // ストリーミングメッセージが送信されていない場合のみ、最終メッセージを返す
  if (!lastSentMessageId) {
    const assistantMessage = messages.find(msg => msg.type === 'assistant');
    if (assistantMessage && assistantMessage.message && assistantMessage.message.content) {
      const content = assistantMessage.message.content;
      // content is an array, extract text from it
      const textContent = content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');
      console.log('Extracted text content:', textContent);
      return { text: textContent, streamed: false };
    }
    
    return { text: 'エラー: Claude Codeからの応答が空でした。', streamed: false };
  }
  
  return { text: null, streamed: true };
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Check if channel has only 2 members (bot + 1 user)
  let shouldRespond = false;
  let content = message.content;
  
  if (message.channel.type === 0 && message.guild) { // Guild text channel
    // Get members who can view this channel
    const members = message.guild.members.cache.filter(member => 
      message.channel.permissionsFor(member).has('ViewChannel')
    );
    const nonBotMembers = members.filter(member => !member.user.bot);
    
    if (nonBotMembers.size === 1) {
      // Only one non-bot member, respond to all messages
      shouldRespond = true;
    }
  }
  
  // Check for mentions
  if (message.mentions.has(client.user) || message.content.includes(`<@${client.user.id}>`)) {
    shouldRespond = true;
    content = message.content
      .replace(`<@${client.user.id}>`, '')
      .replace(`<@!${client.user.id}>`, '')
      .trim();
  }
  
  if (shouldRespond) {
    
    if (content) {
      await message.channel.sendTyping();
      
      try {
        const result = await queryClaudeCode(content, httpPort, message.channel);
        
        // ストリーミングで送信済みの場合
        if (result.streamed && !result.text) {
          console.log('Response already sent via streaming');
          // 最終メッセージを送信
          await message.channel.send('以上でおわりです');
          return;
        }
        
        const response = result.text;
        
        if (!response || response.trim() === '') {
          // ストリーミングで送信済みでない場合のみエラーメッセージを表示
          if (!result.streamed) {
            await message.reply('エラー: Claude Codeからの応答が空でした。Claude Codeが正しく動作しているか確認してください。');
          }
          return;
        }
        
        // ストリーミングで送信していない場合のみ、最終応答を送信
        if (!result.streamed) {
          // Discord's message limit is 2000 characters
          if (response.length <= 2000) {
            await message.reply({ content: response, tts: true });
          } else {
            // Split long messages
            const chunks = [];
            for (let i = 0; i < response.length; i += 1900) {
              chunks.push(response.slice(i, i + 1900));
            }
            
            // Send first chunk as reply
            await message.reply({ content: chunks[0] + '\n...(続く)', tts: true });
            
            // Send remaining chunks as follow-up messages
            for (let i = 1; i < chunks.length; i++) {
              await message.channel.send({
                content: (i === chunks.length - 1) ? chunks[i] : chunks[i] + '\n...(続く)',
                tts: true
              });
            }
          }
          // 最終メッセージを送信
          await message.channel.send('以上でおわりです');
        }
      } catch (error) {
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        await message.reply(`エラーが発生しました: ${error.message || '不明なエラー'}`);
      }
    }
  }
});

// Start HTTP server on available port
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
