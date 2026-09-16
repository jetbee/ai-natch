#!/usr/bin/env node
// blog.hach.work の新着記事を検知し、ai-natch側の「アンサー記事」を1本だけ生成するスクリプト。
// 1回の実行で処理するのは常に1記事まで（PRを小さく保ち、レビューしやすくするため）。

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import Anthropic from '@anthropic-ai/sdk';

const HACH_FEED_URL = 'https://blog.hach.work/feed';
const STATE_PATH = new URL('../data/answered-hach-posts.json', import.meta.url);
const BLOG_DIR = new URL('../src/content/blog/', import.meta.url);
const STYLE_EXAMPLE_PATH = new URL(
  '../src/content/blog/ai-agent-tenpu-anzen-kansatsu-kanousei.md',
  import.meta.url
);
const POSITIONING_PATH = new URL('../docs/POSITIONING-DRAFT.md', import.meta.url);

const MODEL = 'claude-sonnet-5';

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'ai-natch-blog-bot/1.0 (+https://github.com/jetbee/ai-natch)' },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function htmlToPlainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function loadFeedEntries() {
  const xml = await fetchText(HACH_FEED_URL);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xml);
  const feed = parsed.feed ?? parsed.rss?.channel;
  if (!feed) throw new Error('フィードの形式を認識できませんでした（feed/rss.channel が見つかりません）');

  const rawEntries = feed.entry ?? feed.item ?? [];
  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

  return entries.map((e) => {
    let link = e.link;
    if (Array.isArray(link)) {
      link = (link.find((l) => l['@_rel'] === 'alternate') ?? link[0])['@_href'] ?? link[0];
    } else if (link && typeof link === 'object') {
      link = link['@_href'];
    }
    const published = e.published ?? e.pubDate ?? e.updated;
    const summary = e.summary ?? e.description ?? e.content ?? '';
    const summaryText = typeof summary === 'string' ? summary : (summary?.['#text'] ?? '');
    return {
      title: typeof e.title === 'string' ? e.title : (e.title?.['#text'] ?? ''),
      url: link,
      publishedAt: published ? new Date(published) : null,
      summary: htmlToPlainText(summaryText),
    };
  });
}

async function loadAnsweredState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { answered: [] };
  }
}

function slugFromHachUrl(hachUrl) {
  const path = new URL(hachUrl).pathname; // e.g. /2026/09/foo-bar/
  const segment = path.split('/').filter(Boolean).pop() ?? 'post';
  return `${segment}-kotae`;
}

function setGithubOutput(name, value) {
  const outFile = process.env.GITHUB_OUTPUT;
  if (!outFile) return;
  return appendFile(outFile, `${name}=${value}\n`);
}

async function generateArticleBody({ hachTitle, hachUrl, hachText, positioning, styleExample }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY が設定されていません。リポジトリのSecretsに追加してください。'
    );
  }
  const client = new Anthropic({ apiKey });

  const tool = {
    name: 'write_post',
    description: 'ai-natchブログに掲載するアンサー記事を1本書く',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '記事タイトル（日本語、40字前後）' },
        description: { type: 'string', description: '記事の要約（日本語、60〜100字）' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: '記事のタグ（日本語、短い名詞句）',
        },
        body: {
          type: 'string',
          description:
            'Markdown本文（frontmatterは含めない）。見出しはh2(##)から。末尾に元記事へのリンクを "元記事: [タイトル](URL)（HACH Blog）" の形式で必ず含める。',
        },
      },
      required: ['title', 'description', 'tags', 'body'],
    },
  };

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'write_post' },
    messages: [
      {
        role: 'user',
        content: `あなたはai-natchブログの執筆者です。競合であるHACH（blog.hach.work）の新しい記事に対する
「アンサー記事」を1本書いてください。

# ai-natchのポジショニング（ドラフト。まだ未確定な点が多いので、断定的な自社訴求は避けること）
${positioning}

# 文体・構成の参考（直近の自社記事。トーンと構成を踏襲すること）
${styleExample}

# アンサー対象記事
タイトル: ${hachTitle}
URL: ${hachUrl}
本文抜粋:
${hachText.slice(0, 6000)}

# 執筆方針
- 相手記事の課題認識を頭ごなしに否定しない。妥当な点は妥当と認めた上で、別の切り口・見落とされがちな論点を提示する。
- ai-natchの具体的な機能・実績など、確認が取れていない情報は書かない。自社への言及は最後に一言程度に留める。
- である調（だ・である体）で統一する。
- 見出し(##)を2〜4個使い、本文は800〜1400字程度。
- 末尾に元記事へのリンクを必ず入れる。
- write_post ツールを呼び出して結果を返すこと。`,
      },
    ],
  });

  const toolUse = message.content.find((c) => c.type === 'tool_use');
  if (!toolUse) throw new Error('モデルがwrite_postツールを呼び出しませんでした');
  return toolUse.input;
}

async function main() {
  const entries = await loadFeedEntries();
  const state = await loadAnsweredState();
  const answeredUrls = new Set(state.answered.map((a) => a.hachUrl));

  const unanswered = entries
    .filter((e) => e.url && !answeredUrls.has(e.url))
    .sort((a, b) => (a.publishedAt?.valueOf() ?? 0) - (b.publishedAt?.valueOf() ?? 0));

  if (unanswered.length === 0) {
    console.log('新着記事はありません。今回は何もしません。');
    await setGithubOutput('created', 'false');
    return;
  }

  const target = unanswered[0];
  console.log(`対象記事: ${target.title} (${target.url})`);

  const hachHtml = await fetchText(target.url);
  const hachText = htmlToPlainText(hachHtml) || target.summary;

  const [positioning, styleExample] = await Promise.all([
    readFile(POSITIONING_PATH, 'utf-8'),
    readFile(STYLE_EXAMPLE_PATH, 'utf-8'),
  ]);

  const post = await generateArticleBody({
    hachTitle: target.title,
    hachUrl: target.url,
    hachText,
    positioning,
    styleExample,
  });

  const slug = slugFromHachUrl(target.url);
  const today = new Date().toISOString().slice(0, 10);

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(post.title)}`,
    `description: ${JSON.stringify(post.description)}`,
    `pubDate: ${today}`,
    'tags:',
    ...post.tags.map((t) => `  - ${JSON.stringify(t)}`),
    'answerTo:',
    `  title: ${JSON.stringify(target.title)}`,
    `  url: ${JSON.stringify(target.url)}`,
    '---',
    '',
  ].join('\n');

  const body = post.body.trim().includes(target.url)
    ? post.body.trim()
    : `${post.body.trim()}\n\n元記事: [${target.title}](${target.url})（HACH Blog）`;

  const filePath = new URL(`${slug}.md`, BLOG_DIR);
  await writeFile(filePath, `${frontmatter}${body}\n`, 'utf-8');

  state.answered.push({ hachUrl: target.url, answerSlug: slug, answeredAt: today });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');

  console.log(`生成しました: src/content/blog/${slug}.md`);
  await setGithubOutput('created', 'true');
  await setGithubOutput('slug', slug);
  await setGithubOutput('title', post.title);
  await setGithubOutput('hach_url', target.url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
