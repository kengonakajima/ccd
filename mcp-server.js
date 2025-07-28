import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from 'node-fetch';

console.log('[MCP] Creating MCP server instance...');

// MCPサーバーの作成
const server = new McpServer({
  name: "ccd-permissions",
  version: "1.0.0",
  description: "Permission approval server for ccd Discord bot"
});

console.log('[MCP] MCP server instance created');

// approval_promptツールの定義
console.log('[MCP] Registering approval_prompt tool...');
server.tool(
  "approval_prompt",
  "Prompts the user for permission to execute a tool via Discord",
  {
    tool_name: z.string().describe("The name of the tool requesting permission"),
    input: z.object({}).passthrough().describe("The input parameters for the tool"),
    tool_use_id: z.string().optional().describe("The unique tool use request ID"),
  },
  async ({ tool_name, input, tool_use_id }) => {
    console.log(`[MCP] ========== APPROVAL REQUEST RECEIVED ==========`);
    console.log(`[MCP] Tool name: ${tool_name}`);
    console.log(`[MCP] Tool use ID: ${tool_use_id}`);
    console.log(`[MCP] Input:`, JSON.stringify(input, null, 2));
    console.log(`[MCP] ==============================================`);
    
    const requestId = tool_use_id || `req_${Date.now()}`;
    console.log(`[MCP] Using request ID: ${requestId}`);
    
    try {
      // ccd.jsのHTTPエンドポイントにPOST
      console.log(`[MCP] Sending POST request to http://127.0.0.1:3000/approval_request`);
      const requestBody = {
        tool_name,
        input,
        requestId
      };
      console.log(`[MCP] Request body:`, JSON.stringify(requestBody, null, 2));
      console.log(`[MCP] Waiting for response from ccd.js...`);
      
      const response = await fetch('http://127.0.0.1:3000/approval_request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        timeout: 35000 // 35秒のタイムアウト（ccd.js側の30秒より少し長め）
      });
      
      console.log(`[MCP] Response status: ${response.status}`);
      
      const data = await response.json();
      console.log(`[MCP] Response from ccd.js:`, data);
      
      if (data.success) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify(data.result)
          }]
        };
      } else {
        return {
          content: [{
            type: "text",
            text: JSON.stringify(data.result || {
              behavior: "deny",
              message: "承認エンドポイントからエラーが返されました"
            })
          }]
        };
      }
      
    } catch (error) {
      console.error(`[MCP] Error calling approval endpoint:`, error);
      
      // 接続エラーの場合
      if (error.code === 'ECONNREFUSED') {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              behavior: "deny",
              message: "ccd.jsが起動していないか、HTTPサーバーが利用できません"
            })
          }]
        };
      }
      
      // その他のエラー
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            behavior: "deny",
            message: `エラー: ${error.message}`
          })
        }]
      };
    }
  }
);
console.log('[MCP] approval_prompt tool registered');

// MCPサーバーを起動
async function startMcpServer() {
  console.log('[MCP] Starting MCP server...');
  
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('[MCP] MCP server started successfully');
    console.log('[MCP] Will send approval requests to http://127.0.0.1:3000/approval_request');
  } catch (error) {
    console.error('[MCP] Failed to start MCP server:', error);
    throw error;
  }
}

// 常にMCPサーバーを起動
console.log('[MCP] Script loaded, starting MCP server...');
console.log('[MCP] Process args:', process.argv);

startMcpServer().catch((error) => {
  console.error('[MCP] Failed to start server:', error);
  process.exit(1);
});