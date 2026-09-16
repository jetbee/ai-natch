# ai-natch

ai-natchのブログサイト（Astro製・静的サイト）。HACH（blog.hach.work）の新着記事に対する
「アンサー記事」を書いていくブログです。

## 開発

```bash
npm install
npm run dev
```

## 記事の追加

`src/content/blog/` に Markdown ファイルを追加してください。frontmatterのスキーマは
`src/content/config.ts` を参照。HACHの記事へのアンサー記事の場合は `answerTo` を指定します。

## デプロイ

`main` ブランチへのpushで `.github/workflows/deploy.yml` がGitHub Pagesへ自動デプロイします。
リポジトリの Settings > Pages で Source を "GitHub Actions" に設定してください。

## HACHアンサー記事の自動生成

`.github/workflows/hach-answer.yml` が毎日HACHの新着記事（`https://blog.hach.work/feed`）を
チェックし、未対応の記事があれば `scripts/generate-answer-post.mjs` でアンサー記事を1本生成、
ブランチを切ってPRを作成します。内容は人がレビューしてからマージしてください。

このワークフローを動かすには、リポジトリのSecretsに `ANTHROPIC_API_KEY` を設定する必要が
あります（Settings > Secrets and variables > Actions）。

記事のトーン・スタンスは `docs/POSITIONING-DRAFT.md` を参照して生成されます。
ai-natchのプロダクト内容が固まったら、このファイルを更新してください。
