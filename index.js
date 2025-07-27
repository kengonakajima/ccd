import { Client, GatewayIntentBits } from 'discord.js';
import { query } from '@anthropic-ai/claude-code';
import dotenv from 'dotenv';

dotenv.config();

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

async function queryClaudeCode(prompt) {
  const messages = [];
  
  console.log('Querying Claude Code with prompt:', prompt);
  
  for await (const message of query({
    prompt: prompt,
    abortController: new AbortController(),
    options: {
      maxTurns: 20, // for longer tasks, enable development
      "continue": true,
      verbose: true,
      allowedTools: ["Read", "Write", "Edit", "Create","Bash"], // for dev
      permissionMode: "acceptEdits" // for dev
    },
  })) {
    console.log('Received message:', JSON.stringify(message, null, 2));
    messages.push(message);
  }
  
  console.log('All messages:', messages);
  
  // Extract the assistant's response text from the result message
  const resultMessage = messages.find(msg => msg.type === 'result' && msg.subtype === 'success');
  if (resultMessage && resultMessage.result) {
    console.log('Found result:', resultMessage.result);
    return resultMessage.result;
  }
  
  // Try to extract from assistant message
  const assistantMessage = messages.find(msg => msg.type === 'assistant');
  if (assistantMessage && assistantMessage.message && assistantMessage.message.content) {
    const content = assistantMessage.message.content;
    // content is an array, extract text from it
    const textContent = content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n');
    console.log('Extracted text content:', textContent);
    return textContent;
  }
  
  return 'エラー: Claude Codeからの応答が空でした。';
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
        const response = await queryClaudeCode(content);
        
        if (!response || response.trim() === '') {
          await message.reply('エラー: Claude Codeからの応答が空でした。Claude Codeが正しく動作しているか確認してください。');
          return;
        }
        
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
      } catch (error) {
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        await message.reply(`エラーが発生しました: ${error.message || '不明なエラー'}`);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
