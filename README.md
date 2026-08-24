# persona-line-chat

LINE風のUIで、キャラクターペルソナ(おじさん / メンヘラ)とチャットできるアプリ。
返信は毎回 OpenAI モデルにその場で生成させていて、テンプレート文の抜き出しではない。

**公開URL: https://persona-line-chat.vercel.app**

## できること

- LINEそっくりのチャット画面(吹き出し・既定色・タイピング中インジケータ)
- ペルソナ切り替え(おじさん構文 / メンヘラ構文)。ヘッダー右上のセレクトで即切り替え
- 会話開始前のオンボーディング(名前 + くん/ちゃん/呼び捨て)。以後、ペルソナはその名前で呼びかける
- 各ペルソナ専用のアイコン(メンヘラは[いらすとや](https://www.irasutoya.com/2020/06/blog-post_133.html)の地雷メイクイラストを使用)

## 仕組み

```
client/  Vite + React 製のチャットUI。/api/personas と /api/chat をfetchするだけの薄いクライアント
server/  Express。ローカル開発時はこちらが :3001 で /api を待ち受ける
api/     Vercelデプロイ用。server/personas.js のロジックをそのままExpressアプリとして
         サーバーレス関数(api/[...path].js)にラップしたもの。ローカルのserver/とコードは共通
```

`client/` と `server/`+`api/` は別々にデプロイされる想定(client は静的ビルド、server 相当のロジックは
サーバーレス関数)。ローカル開発では `server/` が Express プロセスとして常駐し、Vercel 上では同じロジックが
サーバーレス関数として動く。

### ペルソナの作り方(`server/personas.js`)

各ペルソナは `systemPrompt(userName, honorific) => string` という関数で定義する。ポイントは以下:

1. **最優先ルールは「内容への反応」。** 語彙表(絵文字・顔文字・定型フレーズ)を「毎回使ってください」と
   指示すると、LLMは会話の内容を無視してテンプレ文を貼るだけになる(実際にハマった失敗)。なので語彙は
   「口調のヒント」止まりにして、内容に具体的に反応することをプロンプトの一番上で最優先ルールとして固定している。
2. **語彙表は多め・多様に。** 同じ「タイプ」の顔文字/絵文字ばかり並べると出力も単調になる。にこにこ系だけで
   なく、困り顔・照れ顔・やれやれ顔なども混ぜてある。
3. **キャラの「クセ」を明示的に列挙する。** おじさん構文なら「聞かれてもいないのに自分語りをする」
   「大げさに褒める」「馴れ馴れしく踏み込んだ質問をする」「たまに構ってほしがる」といった、口調だけでは
   なく行動パターンとしての特徴を個別の指示として書くと、キャラらしさが出やすい。
4. **コメディとしての安全策。** メンヘラ・おじさんいずれも「誇張されたネタとしてのキャラ」であることを
   明示し、自傷・自殺・実際の迷惑行為を思わせる表現は禁止する一文を必ず入れている。

新しいペルソナを増やすときは `PERSONAS` オブジェクトに追加するだけでよい。

## セットアップ(ローカル)

```bash
npm install
npm --prefix client install
npm --prefix server install
```

`server/.env` に `OPENAI_API_KEY` を設定する(`server/.env.example` 参照)。任意で `OPENAI_MODEL`
(デフォルト `gpt-4.1-mini`)も指定できる。

## 起動(ローカル)

```bash
npm run dev
```

client: http://localhost:5173 / server: http://localhost:3001(`/api` はViteがプロキシ)

## デプロイ(Vercel)

Vercel プロジェクト名: `persona-line-chat`(GitHubリポジトリと連携済み。`main` へのpushで自動デプロイ)。

- ビルド設定は `vercel.json` で指定(`cd client && npm install && npm run build` / 出力先 `client/dist`)
- API は `api/[...path].js`(Node サーバーレス関数、`/api/*` を全て受ける)。中身は `server/personas.js` を
  そのまま参照している
- 環境変数 `OPENAI_API_KEY` / `OPENAI_MODEL` は Vercel プロジェクトの Environment Variables に
  Production/Preview/Development それぞれ設定済み(`vercel env ls` で確認可能)

手元で再デプロイする場合:

```bash
vercel --prod
```
