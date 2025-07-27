# ccd - Claude Code from Discord


DiscordからClaude Codeを駆動するNode.jsベースのBotツール

## 概要

ccdは、Discord上でClaude Codeと対話できるBotです。メンションして質問すると、Claude Codeが応答します。
チャンネルにBot以外のメンバーが1人だけの場合は、メンション不要で全てのメッセージに応答します。

## 使用上の注意

claude codeは危険なことに使えるので、プライベートチャンネルで使うようにして下さい。



## 必要な環境

- Node.js v18以上
- Claude Code CLIがインストール済み
- Discord Bot Token

## セットアップ

1. 依存関係のインストール
```bash
npm install
```

2. `.env.example`を`.env`にコピーして環境変数を設定
```bash
cp .env.example .env
```

3. Discord Bot Tokenを設定（詳細は`howto.txt`を参照）

## 使い方

```bash
npm start
```

Discordで以下の方法でBotと対話できます：
- 通常：`@BotName メッセージ`でメンション
- 1対1チャンネル：メンション不要で直接メッセージを送信

## 機能

- Discord BotとClaude Codeの連携
- 長文メッセージの自動分割（2000文字以上）
- 1対1チャンネルでのメンション不要対話
- エラーハンドリング