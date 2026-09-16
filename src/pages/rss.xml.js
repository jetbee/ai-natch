import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = await getCollection('blog');
  return rss({
    title: 'ai-natch Blog',
    description: '現場でAIエージェントを動かすための実践ブログ',
    site: new URL(import.meta.env.BASE_URL, context.site).toString(),
    items: posts
      .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
      .map((post) => ({
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.pubDate,
        link: `${import.meta.env.BASE_URL}blog/${post.slug}/`,
      })),
  });
}
